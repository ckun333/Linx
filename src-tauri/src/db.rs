use anyhow::{Context, Result};
use rusqlite::{params, Connection};

use crate::crypto::CryptoService;
use crate::models::{AuthType, Server, ServerGroup};

/// 数据库管理器
pub struct Database {
    conn: Connection,
    crypto: CryptoService,
}

impl Database {
    /// 初始化数据库，创建/打开 SQLite 文件并执行迁移
    pub fn new(db_path: &str) -> Result<Self> {
        let conn = Connection::open(db_path)
            .with_context(|| format!("无法打开数据库: {}", db_path))?;

        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .context("无法设置 WAL 模式")?;

        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .context("无法启用外键约束")?;

        let crypto = CryptoService::new()?;
        let db = Self { conn, crypto };
        db.migrate()?;
        Ok(db)
    }

    /// 创建/更新表结构
    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS server_groups (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                sort_order  INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS servers (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id          INTEGER REFERENCES server_groups(id) ON DELETE SET NULL,
                name              TEXT NOT NULL,
                host              TEXT NOT NULL,
                port              INTEGER NOT NULL DEFAULT 22,
                username          TEXT NOT NULL,
                auth_type         TEXT NOT NULL DEFAULT 'password',
                private_key_path  TEXT,
                password          TEXT,
                sort_order        INTEGER NOT NULL DEFAULT 0
            );
            ",
        )
        .context("数据库迁移失败")?;
        Ok(())
    }

    // ==================== 分组 CRUD ====================

    /// 获取所有分组
    pub fn get_all_groups(&self) -> Result<Vec<ServerGroup>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, sort_order FROM server_groups ORDER BY sort_order, id")
            .context("查询分组失败")?;

        let groups = stmt
            .query_map([], |row| {
                Ok(ServerGroup {
                    id: Some(row.get(0)?),
                    name: row.get(1)?,
                    sort_order: row.get(2)?,
                })
            })
            .context("读取分组数据失败")?
            .collect::<std::result::Result<Vec<_>, _>>()
            .context("遍历分组结果失败")?;

        Ok(groups)
    }

    /// 创建分组
    pub fn create_group(&self, group: &ServerGroup) -> Result<ServerGroup> {
        self.conn
            .execute(
                "INSERT INTO server_groups (name, sort_order) VALUES (?1, ?2)",
                params![group.name, group.sort_order],
            )
            .context("创建分组失败")?;

        let id = self.conn.last_insert_rowid();
        Ok(ServerGroup {
            id: Some(id),
            name: group.name.clone(),
            sort_order: group.sort_order,
        })
    }

    /// 更新分组
    pub fn update_group(&self, group: &ServerGroup) -> Result<()> {
        let id = group
            .id
            .ok_or_else(|| anyhow::anyhow!("分组 ID 不能为空"))?;

        self.conn
            .execute(
                "UPDATE server_groups SET name = ?1, sort_order = ?2 WHERE id = ?3",
                params![group.name, group.sort_order, id],
            )
            .context("更新分组失败")?;
        Ok(())
    }

    /// 删除分组
    pub fn delete_group(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM server_groups WHERE id = ?1", params![id])
            .context("删除分组失败")?;
        Ok(())
    }

    // ==================== 服务器 CRUD ====================

    /// 获取所有服务器（列表视图，密码不返回）
    pub fn get_all_servers(&self) -> Result<Vec<Server>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, group_id, name, host, port, username, auth_type, \
                        private_key_path, password, sort_order \
                 FROM servers ORDER BY sort_order, id",
            )
            .context("查询服务器列表失败")?;

        let servers = stmt
            .query_map([], |row| {
                let auth_type_str: String = row.get(6)?;
                let auth_type = match auth_type_str.as_str() {
                    "key" => AuthType::Key,
                    _ => AuthType::Password,
                };

                Ok(Server {
                    id: Some(row.get(0)?),
                    group_id: row.get(1)?,
                    name: row.get(2)?,
                    host: row.get(3)?,
                    port: row.get::<_, i32>(4)? as u16,
                    username: row.get(5)?,
                    auth_type,
                    private_key_path: row.get(7)?,
                    // 列表视图不返回密码
                    password: None,
                    sort_order: row.get(9)?,
                })
            })
            .context("读取服务器数据失败")?
            .collect::<std::result::Result<Vec<_>, _>>()
            .context("遍历服务器结果失败")?;

        Ok(servers)
    }

    /// 根据 ID 获取服务器（含解密后的密码，仅用于编辑）
    pub fn get_server_by_id(&self, id: i64) -> Result<Server> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, group_id, name, host, port, username, auth_type, \
                        private_key_path, password, sort_order \
                 FROM servers WHERE id = ?1",
            )
            .context("查询服务器失败")?;

        let server = stmt
            .query_row(params![id], |row| {
                let auth_type_str: String = row.get(6)?;
                let auth_type = match auth_type_str.as_str() {
                    "key" => AuthType::Key,
                    _ => AuthType::Password,
                };

                let encrypted_password: Option<String> = row.get(8)?;

                // 解密密码用于编辑回显
                let password = encrypted_password
                    .as_ref()
                    .map(|enc| self.crypto.decrypt(enc).unwrap_or_else(|_| "••••••".to_string()));

                Ok(Server {
                    id: Some(row.get(0)?),
                    group_id: row.get(1)?,
                    name: row.get(2)?,
                    host: row.get(3)?,
                    port: row.get::<_, i32>(4)? as u16,
                    username: row.get(5)?,
                    auth_type,
                    private_key_path: row.get(7)?,
                    password,
                    sort_order: row.get(9)?,
                })
            })
            .context("未找到指定服务器")?;

        Ok(server)
    }

    /// 获取服务器密码（解密后，用于 SSH 连接，不在前端暴露）
    ///
    /// 如果密码是旧版明文（解密失败），会自动原地加密迁移。
    pub fn get_server_password(&self, id: i64) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT password FROM servers WHERE id = ?1")
            .context("查询服务器密码失败")?;

        let encrypted: Option<String> = stmt
            .query_row(params![id], |row| row.get(0))
            .context("未找到指定服务器")?;

        match encrypted {
            Some(enc) => {
                match self.crypto.decrypt(&enc) {
                    Ok(decrypted) => Ok(Some(decrypted)),
                    Err(_) => {
                        // 解密失败：可能是旧版明文密码，原地加密迁移
                        let encrypted_new = self.crypto.encrypt(&enc)?;
                        self.conn
                            .execute(
                                "UPDATE servers SET password = ?1 WHERE id = ?2",
                                params![encrypted_new, id],
                            )
                            .context("迁移密码失败")?;
                        Ok(Some(enc))
                    }
                }
            }
            None => Ok(None),
        }
    }

    /// 创建服务器（密码自动加密后存储）
    pub fn create_server(&self, server: &Server) -> Result<Server> {
        let auth_type_str = match server.auth_type {
            AuthType::Key => "key",
            AuthType::Password => "password",
        };

        // 加密密码
        let encrypted_password = match &server.password {
            Some(pwd) if !pwd.is_empty() => Some(self.crypto.encrypt(pwd)?),
            _ => None,
        };

        self.conn
            .execute(
                "INSERT INTO servers (group_id, name, host, port, username, auth_type, \
                                      private_key_path, password, sort_order) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    server.group_id,
                    server.name,
                    server.host,
                    server.port as i32,
                    server.username,
                    auth_type_str,
                    server.private_key_path,
                    encrypted_password,
                    server.sort_order,
                ],
            )
            .context("创建服务器失败")?;

        let id = self.conn.last_insert_rowid();
        Ok(Server {
            id: Some(id),
            // 返回时不包含密码
            password: None,
            ..server.clone()
        })
    }

    /// 更新服务器
    ///
    /// 密码处理规则：
    /// - 如果提供了新密码且不为空，则加密后更新
    /// - 如果 password 为 None 或空字符串，保留数据库中现有密码不变
    /// - 如果 password 为 Some("••••••")，保留现有密码（前端未修改时的占位符）
    pub fn update_server(&self, server: &Server) -> Result<()> {
        let id = server
            .id
            .ok_or_else(|| anyhow::anyhow!("服务器 ID 不能为空"))?;

        let auth_type_str = match server.auth_type {
            AuthType::Key => "key",
            AuthType::Password => "password",
        };

        let final_password: Option<String> = match &server.password {
            Some(pwd) if pwd == "••••••" || pwd.is_empty() => {
                self.get_existing_encrypted_password(id)?
            }
            Some(pwd) => {
                Some(self.crypto.encrypt(pwd)?)
            }
            None => {
                self.get_existing_encrypted_password(id)?
            }
        };

        self.conn
            .execute(
                "UPDATE servers SET group_id=?1, name=?2, host=?3, port=?4, username=?5, \
                                    auth_type=?6, private_key_path=?7, password=?8, sort_order=?9 \
                 WHERE id=?10",
                params![
                    server.group_id,
                    server.name,
                    server.host,
                    server.port as i32,
                    server.username,
                    auth_type_str,
                    server.private_key_path,
                    final_password,
                    server.sort_order,
                    id,
                ],
            )
            .context("更新服务器失败")?;
        Ok(())
    }

    /// 获取数据库中已加密的密码（用于更新时不改变密码的场景）
    fn get_existing_encrypted_password(&self, id: i64) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT password FROM servers WHERE id = ?1")
            .context("查询现有密码失败")?;

        let result: Result<Option<String>, _> = stmt.query_row(params![id], |row| row.get(0));
        match result {
            Ok(val) => Ok(val),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(anyhow::anyhow!("查询现有密码失败: {}", e)),
        }
    }

    /// 删除服务器
    pub fn delete_server(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM servers WHERE id = ?1", params![id])
            .context("删除服务器失败")?;
        Ok(())
    }

    // ==================== 导入/导出 ====================

    /// 导出所有配置为 JSON
    ///
    /// 导出时密码保持数据库中已加密的状态
    pub fn export_config(&self) -> Result<crate::models::ConfigExport> {
        let groups = self.get_all_groups()?;

        // 导出时直接读取加密密码（不经过 get_all_servers 的密码擦除）
        let servers = self.export_servers_with_encrypted_passwords()?;

        Ok(crate::models::ConfigExport {
            version: env!("CARGO_PKG_VERSION").to_string(),
            groups,
            servers,
        })
    }

    /// 导出服务器时保留加密密码
    fn export_servers_with_encrypted_passwords(&self) -> Result<Vec<Server>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, group_id, name, host, port, username, auth_type, \
                        private_key_path, password, sort_order \
                 FROM servers ORDER BY sort_order, id",
            )
            .context("查询服务器导出数据失败")?;

        let servers = stmt
            .query_map([], |row| {
                let auth_type_str: String = row.get(6)?;
                let auth_type = match auth_type_str.as_str() {
                    "key" => AuthType::Key,
                    _ => AuthType::Password,
                };

                Ok(Server {
                    id: Some(row.get(0)?),
                    group_id: row.get(1)?,
                    name: row.get(2)?,
                    host: row.get(3)?,
                    port: row.get::<_, i32>(4)? as u16,
                    username: row.get(5)?,
                    auth_type,
                    private_key_path: row.get(7)?,
                    // 导出时保留加密密码
                    password: row.get(8)?,
                    sort_order: row.get(9)?,
                })
            })
            .context("读取服务器导出数据失败")?
            .collect::<std::result::Result<Vec<_>, _>>()
            .context("遍历服务器导出结果失败")?;

        Ok(servers)
    }

    /// 从 JSON 导入配置
    ///
    /// 密码处理：
    /// - 如果密码看起来像加密文本（base64），尝试解密验证，解密成功则保持原样存储
    /// - 解密失败或为明文，则在存储前加密
    /// - 空/None 密码保持不变
    pub fn import_config(&self, export: &crate::models::ConfigExport) -> Result<()> {
        // 先清空现有数据
        self.conn
            .execute_batch("DELETE FROM servers; DELETE FROM server_groups;")
            .context("清空旧数据失败")?;

        // 导入分组（记录新旧 ID 映射）
        let mut group_id_map: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
        for group in &export.groups {
            let old_id = group.id;
            let new_group = self.create_group(group)?;
            if let Some(old) = old_id {
                if let Some(new_id) = new_group.id {
                    group_id_map.insert(old, new_id);
                }
            }
        }

        // 导入服务器
        for server in &export.servers {
            let mut s = server.clone();
            // 映射分组 ID
            if let Some(old_gid) = s.group_id {
                s.group_id = group_id_map.get(&old_gid).copied();
            }
            self.import_server(&s)?;
        }

        Ok(())
    }

    /// 导入单台服务器，自动处理密码加密
    fn import_server(&self, server: &Server) -> Result<()> {
        let mut s = server.clone();

        // 处理密码：如果已加密则保持原样，否则加密
        if let Some(pwd) = &s.password {
            if !pwd.is_empty() {
                // 尝试解密，看是否已经是加密格式
                let is_encrypted = self.crypto.decrypt(pwd).is_ok();
                if !is_encrypted {
                    // 明文密码，需要加密
                    s.password = Some(self.crypto.encrypt(pwd)?);
                }
                // 已加密的保持原样
            }
        }

        // 使用 create_server 会再次加密，直接写入数据库
        let auth_type_str = match s.auth_type {
            AuthType::Key => "key",
            AuthType::Password => "password",
        };

        self.conn
            .execute(
                "INSERT INTO servers (group_id, name, host, port, username, auth_type, \
                                      private_key_path, password, sort_order) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    s.group_id,
                    s.name,
                    s.host,
                    s.port as i32,
                    s.username,
                    auth_type_str,
                    s.private_key_path,
                    s.password,
                    s.sort_order,
                ],
            )
            .context("导入服务器失败")?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_db() -> Database {
        let crypto = CryptoService::new().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
        conn.execute_batch("PRAGMA foreign_keys=ON;").ok();

        let db = Database { conn, crypto };
        db.migrate().unwrap();
        db
    }

    #[test]
    fn test_create_server_encrypts_password() {
        let db = create_test_db();

        let server = Server {
            id: None,
            group_id: None,
            name: "test".into(),
            host: "192.168.1.1".into(),
            port: 22,
            username: "root".into(),
            auth_type: AuthType::Password,
            private_key_path: None,
            password: Some("my_secret_password".into()),
            sort_order: 0,
        };

        let created = db.create_server(&server).unwrap();
        assert!(created.id.is_some());

        // 写入直接查询数据库中的密码，应该是加密的
        let encrypted: String = db.conn
            .query_row("SELECT password FROM servers WHERE id = ?1", params![created.id.unwrap()], |row| row.get(0))
            .unwrap();

        assert_ne!(encrypted, "my_secret_password");
        assert!(encrypted.len() > 20); // 加密后应该更长
    }

    #[test]
    fn test_get_all_servers_hides_password() {
        let db = create_test_db();

        let server = Server {
            id: None,
            group_id: None,
            name: "test".into(),
            host: "192.168.1.1".into(),
            port: 22,
            username: "root".into(),
            auth_type: AuthType::Password,
            private_key_path: None,
            password: Some("secret".into()),
            sort_order: 0,
        };

        db.create_server(&server).unwrap();
        let servers = db.get_all_servers().unwrap();

        assert_eq!(servers.len(), 1);
        assert!(servers[0].password.is_none());
    }

    #[test]
    fn test_get_server_by_id_returns_decrypted_password() {
        let db = create_test_db();

        let server = Server {
            id: None,
            group_id: None,
            name: "test".into(),
            host: "192.168.1.1".into(),
            port: 22,
            username: "root".into(),
            auth_type: AuthType::Password,
            private_key_path: None,
            password: Some("my_secret".into()),
            sort_order: 0,
        };

        let created = db.create_server(&server).unwrap();
        let fetched = db.get_server_by_id(created.id.unwrap()).unwrap();

        assert_eq!(fetched.password, Some("my_secret".to_string()));
    }

    #[test]
    fn test_get_server_password_for_ssh() {
        let db = create_test_db();

        let server = Server {
            id: None,
            group_id: None,
            name: "test".into(),
            host: "192.168.1.1".into(),
            port: 22,
            username: "root".into(),
            auth_type: AuthType::Password,
            private_key_path: None,
            password: Some("ssh_secret".into()),
            sort_order: 0,
        };

        let created = db.create_server(&server).unwrap();
        let password = db.get_server_password(created.id.unwrap()).unwrap();

        assert_eq!(password, Some("ssh_secret".to_string()));
    }

    #[test]
    fn test_update_server_new_password() {
        let db = create_test_db();

        let server = Server {
            id: None,
            group_id: None,
            name: "test".into(),
            host: "192.168.1.1".into(),
            port: 22,
            username: "root".into(),
            auth_type: AuthType::Password,
            private_key_path: None,
            password: Some("old_pwd".into()),
            sort_order: 0,
        };

        let created = db.create_server(&server).unwrap();

        // 更新密码
        let updated = Server {
            id: Some(created.id.unwrap()),
            password: Some("new_pwd".into()),
            ..server
        };
        db.update_server(&updated).unwrap();

        // 验证新密码
        let fetched = db.get_server_by_id(created.id.unwrap()).unwrap();
        assert_eq!(fetched.password, Some("new_pwd".to_string()));
    }

    #[test]
    fn test_update_server_keep_password() {
        let db = create_test_db();

        let server = Server {
            id: None,
            group_id: None,
            name: "test".into(),
            host: "192.168.1.1".into(),
            port: 22,
            username: "root".into(),
            auth_type: AuthType::Password,
            private_key_path: None,
            password: Some("keep_me".into()),
            sort_order: 0,
        };

        let created = db.create_server(&server).unwrap();

        // 更新时不提供密码（password: None）
        let updated = Server {
            id: Some(created.id.unwrap()),
            password: None,
            name: "new_name".into(),
            ..server
        };
        db.update_server(&updated).unwrap();

        // 密码应保持不变
        let fetched = db.get_server_by_id(created.id.unwrap()).unwrap();
        assert_eq!(fetched.name, "new_name");
        assert_eq!(fetched.password, Some("keep_me".to_string()));
    }

    #[test]
    fn test_update_server_placeholder_password() {
        let db = create_test_db();

        let server = Server {
            id: None,
            group_id: None,
            name: "test".into(),
            host: "192.168.1.1".into(),
            port: 22,
            username: "root".into(),
            auth_type: AuthType::Password,
            private_key_path: None,
            password: Some("dont_change".into()),
            sort_order: 0,
        };

        let created = db.create_server(&server).unwrap();

        // 前端传回占位符 ••••••
        let updated = Server {
            id: Some(created.id.unwrap()),
            password: Some("••••••".into()),
            ..server
        };
        db.update_server(&updated).unwrap();

        // 密码应保持不变
        let fetched = db.get_server_by_id(created.id.unwrap()).unwrap();
        assert_eq!(fetched.password, Some("dont_change".to_string()));
    }

    #[test]
    fn test_update_server_keep_password_on_empty() {
        let db = create_test_db();

        let server = Server {
            id: None,
            group_id: None,
            name: "test".into(),
            host: "192.168.1.1".into(),
            port: 22,
            username: "root".into(),
            auth_type: AuthType::Password,
            private_key_path: None,
            password: Some("keep_me".into()),
            sort_order: 0,
        };

        let created = db.create_server(&server).unwrap();

        // 前端传回空字符串，应保留现有密码
        let updated = Server {
            id: Some(created.id.unwrap()),
            password: Some("".into()),
            ..server
        };
        db.update_server(&updated).unwrap();

        let fetched = db.get_server_by_id(created.id.unwrap()).unwrap();
        assert_eq!(fetched.password, Some("keep_me".to_string()));
    }

    #[test]
    fn test_get_server_password_plaintext_migration() {
        let db = create_test_db();

        // 模拟旧版明文密码：直接写入数据库
        db.conn
            .execute(
                "INSERT INTO servers (name, host, port, username, auth_type, password, sort_order) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params!["old_server", "10.0.0.1", 22, "root", "password", "old_plaintext_pwd", 0],
            )
            .unwrap();

        let server_id = db.conn.last_insert_rowid();

        // 获取密码：应能正确处理明文并自动迁移
        let password = db.get_server_password(server_id).unwrap();
        assert_eq!(password, Some("old_plaintext_pwd".to_string()));

        // 验证数据库中已更新为加密密码
        let stored: String = db
            .conn
            .query_row(
                "SELECT password FROM servers WHERE id = ?1",
                params![server_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(stored, "old_plaintext_pwd");

        // 验证第二次读取可以正常解密
        let password2 = db.get_server_password(server_id).unwrap();
        assert_eq!(password2, Some("old_plaintext_pwd".to_string()));
    }

    #[test]
    fn test_import_config_handles_passwords() {
        let db = create_test_db();

        // 准备导出数据
        let export = crate::models::ConfigExport {
            version: "0.1.0".into(),
            groups: vec![ServerGroup {
                id: Some(1),
                name: "group1".into(),
                sort_order: 0,
            }],
            servers: vec![Server {
                id: Some(1),
                group_id: Some(1),
                name: "imported".into(),
                host: "10.0.0.1".into(),
                port: 2222,
                username: "admin".into(),
                auth_type: AuthType::Password,
                private_key_path: None,
                password: Some("imported_pwd".into()),
                sort_order: 0,
            }],
        };

        db.import_config(&export).unwrap();

        let servers = db.get_all_servers().unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "imported");

        // 验证密码已加密存储
        let encrypted: String = db.conn
            .query_row("SELECT password FROM servers WHERE id = ?1", params![servers[0].id.unwrap()], |row| row.get(0))
            .unwrap();
        assert_ne!(encrypted, "imported_pwd");

        // 验证可以正确解密
        let fetched = db.get_server_by_id(servers[0].id.unwrap()).unwrap();
        assert_eq!(fetched.password, Some("imported_pwd".to_string()));
    }
}
