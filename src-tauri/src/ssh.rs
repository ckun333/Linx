use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{Context, Result};
use ssh2::{Channel, Session, Sftp};

use crate::models::AuthType;

/// 管理一个 SSH 连接
pub struct SshConnection {
    #[allow(dead_code)]
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
        session.disconnect(Some(ssh2::DisconnectCode::ByApplication), "正常断开", None::<&str>)
            .context("断开 SSH 连接失败")?;
        Ok(())
    }

    /// 检查连接是否仍然有效
    #[allow(dead_code)]
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

/// 交互式 PTY Shell
///
/// 建立独立的 SSH 连接，通过 PTY 实现交互式终端。
/// 读线程持续从 SSH channel 读取输出并通过 mpsc 通道发送。
pub struct InteractiveShell {
    #[allow(dead_code)]
    pub server_id: i64,
    session: Session,
    channel: Arc<Mutex<Channel>>,
    output_rx: Receiver<Vec<u8>>,
    stdin_tx: Sender<Vec<u8>>,
    stop_flag: Arc<Mutex<bool>>,
    join_handle: Option<thread::JoinHandle<()>>,
}

impl InteractiveShell {
    /// 建立交互式 SSH shell 连接
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
        tcp.set_read_timeout(Some(std::time::Duration::from_secs(30)))?;
        tcp.set_write_timeout(Some(std::time::Duration::from_secs(30)))?;

        let mut session = Session::new().context("创建 SSH session 失败")?;
        session.set_tcp_stream(tcp);
        session.handshake().context("SSH 握手失败")?;

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

        if !session.authenticated() {
            anyhow::bail!("SSH 认证未通过");
        }

        // 打开 channel 并请求 PTY（阻塞模式下完成初始化）
        let mut channel = session.channel_session().context("打开 SSH channel 失败")?;

        // 请求 PTY（xterm-256color，初始 80x24）
        channel
            .request_pty("xterm-256color", None, Some((80, 24, 0, 0)))
            .context("请求 PTY 失败")?;

        // 启动 shell
        channel.shell().context("启动 shell 失败")?;

        // 初始化完成后设置为非阻塞模式，供后续读写线程使用
        session.set_blocking(false);

        let channel = Arc::new(Mutex::new(channel));
        let stop_flag = Arc::new(Mutex::new(false));

        // 创建输出通道（stdout → 前端）
        let (output_tx, output_rx): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = mpsc::channel();

        // 创建输入通道（前端 → stdin）
        let (stdin_tx, stdin_rx): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = mpsc::channel();

        // 读线程：从 SSH channel stdout 读取数据并发送到 output channel
        let read_channel = channel.clone();
        let read_stop = stop_flag.clone();
        let read_handle = thread::Builder::new()
            .name(format!("ssh-read-{}", server_id))
            .spawn(move || {
                let mut buf = vec![0u8; 8192];
                loop {
                    if *read_stop.lock().unwrap() {
                        break;
                    }

                    let mut ch = read_channel.lock().unwrap();
                    match ch.read(&mut buf) {
                        Ok(0) => break, // EOF
                        Ok(n) => {
                            let data = buf[..n].to_vec();
                            if output_tx.send(data).is_err() {
                                break; // 接收端已关闭
                            }
                        }
                        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            // 非阻塞模式下无数据可读，短暂休眠后重试
                            drop(ch);
                            thread::sleep(std::time::Duration::from_millis(10));
                            continue;
                        }
                        Err(_) => {
                            // 读取错误，退出循环
                            break;
                        }
                    }
                }
            })
            .context("创建 SSH 读线程失败")?;

        // 写线程：从 stdin channel 接收数据并写入 SSH channel
        let write_channel = channel.clone();
        let write_stop = stop_flag.clone();
        let _write_handle = thread::Builder::new()
            .name(format!("ssh-write-{}", server_id))
            .spawn(move || {
                loop {
                    if *write_stop.lock().unwrap() {
                        break;
                    }

                    match stdin_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                        Ok(data) => {
                            let mut ch = write_channel.lock().unwrap();
                            let _ = ch.write_all(&data);
                            let _ = ch.flush();
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    }
                }
            })
            .context("创建 SSH 写线程失败")?;

        Ok(Self {
            server_id,
            session,
            channel,
            output_rx,
            stdin_tx,
            stop_flag,
            join_handle: Some(read_handle),
        })
    }

    /// 向 shell 的 stdin 写入数据
    pub fn write_stdin(&self, data: &[u8]) -> Result<()> {
        self.stdin_tx
            .send(data.to_vec())
            .map_err(|e| anyhow::anyhow!("写入 stdin 失败: {}", e))
    }

    /// 调整 PTY 尺寸
    pub fn resize_pty(&self, cols: u32, rows: u32) -> Result<()> {
        let mut channel = self
            .channel
            .lock()
            .map_err(|e| anyhow::anyhow!("获取 channel 锁失败: {}", e))?;
        channel
            .request_pty_size(cols, rows, None, None)
            .context("调整 PTY 尺寸失败")
    }

    /// 获取输出接收器
    pub fn take_output_rx(&mut self) -> Receiver<Vec<u8>> {
        std::mem::replace(&mut self.output_rx, mpsc::channel::<Vec<u8>>().1)
    }

    /// 关闭 shell 连接
    pub fn close(&mut self) -> Result<()> {
        // 设置停止标志
        if let Ok(mut flag) = self.stop_flag.lock() {
            *flag = true;
        }

        // 等待读线程结束
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }

        // 发送 EOF 到 channel
        if let Ok(mut ch) = self.channel.lock() {
            let _ = ch.send_eof();
            let _ = ch.wait_close();
        }

        // 断开 session
        self.session
            .disconnect(Some(ssh2::DisconnectCode::ByApplication), "用户断开", None::<&str>)
            .ok();

        Ok(())
    }
}

impl Drop for InteractiveShell {
    fn drop(&mut self) {
        let _ = self.close();
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
