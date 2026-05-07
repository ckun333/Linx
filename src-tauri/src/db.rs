use anyhow::{Context, Result};
use rusqlite::{params, Connection};

use crate::models::{AuthType, Server, ServerGroup};

/// 数据库管理器
pub struct Database {
    conn: Connection,
}

impl Database {
    /// 初始化数据库，创建/打开 SQLite 文件并执行迁移
    pub fn new(db_path: &str) -> Result<Self> {
        let conn = Connection::open(db_path)
            .with_context(|| format!("无法打开数据库: {}", db_path))?;

        // 启用 WAL 模式提升并发性能
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .context("无法设置 WAL 模式")?;

        // 启用外键约束
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .context("无法启用外键约束")?;

        let db = Self { conn };
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

    /// 获取所有服务器
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
                    password: row.get(8)?,
                    sort_order: row.get(9)?,
                })
            })
            .context("读取服务器数据失败")?
            .collect::<std::result::Result<Vec<_>, _>>()
            .context("遍历服务器结果失败")?;

        Ok(servers)
    }

    /// 创建服务器
    pub fn create_server(&self, server: &Server) -> Result<Server> {
        let auth_type_str = match server.auth_type {
            AuthType::Key => "key",
            AuthType::Password => "password",
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
                    server.password,
                    server.sort_order,
                ],
            )
            .context("创建服务器失败")?;

        let id = self.conn.last_insert_rowid();
        Ok(Server {
            id: Some(id),
            ..server.clone()
        })
    }

    /// 更新服务器
    pub fn update_server(&self, server: &Server) -> Result<()> {
        let id = server
            .id
            .ok_or_else(|| anyhow::anyhow!("服务器 ID 不能为空"))?;

        let auth_type_str = match server.auth_type {
            AuthType::Key => "key",
            AuthType::Password => "password",
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
                    server.password,
                    server.sort_order,
                    id,
                ],
            )
            .context("更新服务器失败")?;
        Ok(())
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
    pub fn export_config(&self) -> Result<crate::models::ConfigExport> {
        let groups = self.get_all_groups()?;
        let servers = self.get_all_servers()?;

        Ok(crate::models::ConfigExport {
            version: env!("CARGO_PKG_VERSION").to_string(),
            groups,
            servers,
        })
    }

    /// 从 JSON 导入配置
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
            self.create_server(&s)?;
        }

        Ok(())
    }
}
