use std::net::TcpStream;
use std::path::Path;
use std::sync::Mutex;

use std::io::Read;

use anyhow::{Context, Result};
use ssh2::{ Session, Sftp };

use crate::models::AuthType;

/// 管理一个 SSH 连接
pub struct SshConnection {
    pub server_id: i64,
    pub session: Mutex<Session>,
}

impl SshConnection {
    /// 建立 SSH 连接
    pub fn connect(
        server_id: i64,
        host: &str,
        port: u16,
        username: &str,
        auth_type: &AuthType,
        private_key_path: &Option<String>,
        password: &Option<String>,
    ) -> Result<Self> {
        let addr = format!("{}:{}", host, port);
        let tcp = TcpStream::connect(&addr)
            .with_context(|| format!("无法连接到 {}:{}", host, port))?;

        // 设置超时
        tcp.set_read_timeout(Some(std::time::Duration::from_secs(30)))
            .context("设置读取超时失败")?;
        tcp.set_write_timeout(Some(std::time::Duration::from_secs(30)))
            .context("设置写入超时失败")?;

        let mut session = Session::new()
            .context("创建 SSH session 失败")?;

        session.set_tcp_stream(tcp);
        session.handshake()
            .context("SSH 握手失败")?;

        // 认证
        match auth_type {
            AuthType::Key => {
                let key_path = private_key_path
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("密钥认证需要提供私钥路径"))?;

                if !Path::new(key_path).exists() {
                    anyhow::bail!("私钥文件不存在: {}", key_path);
                }

                session
                    .userauth_pubkey_file(username, None, Path::new(key_path), password.as_deref())
                    .context("SSH 密钥认证失败")?;
            }
            AuthType::Password => {
                let pass = password
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("密码认证需要提供密码"))?;

                session
                    .userauth_password(username, pass)
                    .context("SSH 密码认证失败")?;
            }
        }

        // 验证是否已认证
        if !session.authenticated() {
            anyhow::bail!("SSH 认证未通过");
        }

        Ok(Self {
            server_id,
            session: Mutex::new(session),
        })
    }

    /// 在远程服务器上执行命令并返回输出
    pub fn exec_command(&self, command: &str) -> Result<String> {
        let session = self.session.lock().map_err(|e| anyhow::anyhow!("锁获取失败: {}", e))?;

        let mut channel = session.channel_session()
            .context("打开 SSH channel 失败")?;

        channel.exec(command)
            .with_context(|| format!("执行命令失败: {}", command))?;

        // 读取 stdout
        let mut output = String::new();
        channel.read_to_string(&mut output)
            .context("读取命令输出失败")?;

        // 等待命令完成
        channel.wait_close()
            .context("等待命令关闭失败")?;

        // 检查退出状态
        let exit_status = channel.exit_status()
            .context("获取退出状态失败")?;
        if exit_status != 0 {
            anyhow::bail!("命令退出码: {} (命令: {})", exit_status, command);
        }

        Ok(output)
    }

    /// 断开连接
    pub fn disconnect(&self) -> Result<()> {
        let session = self.session.lock().map_err(|e| anyhow::anyhow!("锁获取失败: {}", e))?;
        session.disconnect(ssh2::DisconnectCode::Normal, "正常断开", "")
            .context("断开 SSH 连接失败")?;
        Ok(())
    }

    /// 检查连接是否仍然有效
    pub fn is_connected(&self) -> bool {
        if let Ok(session) = self.session.lock() {
            session.authenticated()
        } else {
            false
        }
    }

    /// 获取 SFTP 会话以浏览远程文件
    pub fn sftp(&self) -> Result<Sftp> {
        let session = self.session.lock().map_err(|e| anyhow::anyhow!("锁获取失败: {}", e))?;
        session.sftp().context("创建 SFTP 会话失败")
    }

    /// 列出远程目录内容
    pub fn list_dir(&self, path: &str) -> Result<Vec<RemoteFileInfo>> {
        let sftp = self.sftp()?;
        let entries = sftp.readdir(Path::new(path))
            .with_context(|| format!("读取远程目录失败: {}", path))?;

        let mut files = Vec::new();
        for (entry_path, stat) in entries {
            let file_name = entry_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            files.push(RemoteFileInfo {
                name: file_name,
                path: entry_path.to_string_lossy().to_string(),
                is_dir: stat.is_dir(),
                is_symlink: stat.file_type().is_symlink(),
                size: stat.size.unwrap_or(0),
                permissions: stat.perm.unwrap_or(0),
                modified: stat.mtime.unwrap_or(0),
            });
        }

        // 按名称排序：目录在前，文件在后
        files.sort_by(|a, b| {
            if a.is_dir != b.is_dir {
                b.is_dir.cmp(&a.is_dir)
            } else {
                a.name.cmp(&b.name)
            }
        });

        Ok(files)
    }
}

/// 远程文件信息
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct RemoteFileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub permissions: u32,
    pub modified: u64,
}
