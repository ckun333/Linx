use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::Result;
use tauri::State;

use crate::db::Database;
use crate::models::{AuthType, ConfigExport, Server, ServerGroup, ServerStatus};
use crate::monitor;
use crate::ssh::{RemoteFileInfo, SshConnection};

/// 应用状态：持有数据库和活跃 SSH 连接池
pub struct AppState {
    pub db: Mutex<Database>,
    /// server_id -> SshConnection
    pub connections: Mutex<HashMap<i64, SshConnection>>,
}

// ==================== 分组命令 ====================

#[tauri::command]
pub fn get_groups(state: State<AppState>) -> Result<Vec<ServerGroup>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_groups().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_group(state: State<AppState>, name: String, sort_order: i32) -> Result<ServerGroup, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let group = ServerGroup {
        id: None,
        name,
        sort_order,
    };
    db.create_group(&group).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_group(state: State<AppState>, id: i64, name: String, sort_order: i32) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let group = ServerGroup {
        id: Some(id),
        name,
        sort_order,
    };
    db.update_group(&group).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_group(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_group(id).map_err(|e| e.to_string())
}

// ==================== 服务器命令 ====================

#[tauri::command]
pub fn get_servers(state: State<AppState>) -> Result<Vec<Server>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_servers().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_server(
    state: State<AppState>,
    group_id: Option<i64>,
    name: String,
    host: String,
    port: u16,
    username: String,
    auth_type: String,
    private_key_path: Option<String>,
    password: Option<String>,
    sort_order: i32,
) -> Result<Server, String> {
    let auth_type = match auth_type.as_str() {
        "key" => AuthType::Key,
        _ => AuthType::Password,
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let server = Server {
        id: None,
        group_id,
        name,
        host,
        port,
        username,
        auth_type,
        private_key_path,
        password,
        sort_order,
    };
    db.create_server(&server).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_server(
    state: State<AppState>,
    id: i64,
    group_id: Option<i64>,
    name: String,
    host: String,
    port: u16,
    username: String,
    auth_type: String,
    private_key_path: Option<String>,
    password: Option<String>,
    sort_order: i32,
) -> Result<(), String> {
    let auth_type = match auth_type.as_str() {
        "key" => AuthType::Key,
        _ => AuthType::Password,
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let server = Server {
        id: Some(id),
        group_id,
        name,
        host,
        port,
        username,
        auth_type,
        private_key_path,
        password,
        sort_order,
    };
    db.update_server(&server).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_server(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_server(id).map_err(|e| e.to_string())
}

// ==================== SSH 连接命令 ====================

#[tauri::command]
pub fn connect_ssh(
    state: State<AppState>,
    server_id: i64,
) -> Result<String, String> {
    // 从数据库读取服务器信息
    let server = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let servers = db.get_all_servers().map_err(|e| e.to_string())?;
        servers.into_iter().find(|s| s.id == Some(server_id))
            .ok_or_else(|| "未找到服务器".to_string())?
    };

    let conn = SshConnection::connect(
        server_id,
        &server.host,
        server.port,
        &server.username,
        &server.auth_type,
        &server.private_key_path,
        &server.password,
    )
    .map_err(|e| format!("SSH 连接失败: {}", e))?;

    // 保存到连接池
    let mut connections = state.connections.lock().map_err(|e| e.to_string())?;
    connections.insert(server_id, conn);

    Ok(format!("已连接到 {}", server.name))
}

#[tauri::command]
pub fn disconnect_ssh(state: State<AppState>, server_id: i64) -> Result<String, String> {
    let mut connections = state.connections.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = connections.remove(&server_id) {
        conn.disconnect().map_err(|e| format!("断开连接失败: {}", e))?;
        Ok("已断开连接".to_string())
    } else {
        Err("未找到活跃连接".to_string())
    }
}

#[tauri::command]
pub fn exec_ssh(state: State<AppState>, server_id: i64, command: String) -> Result<String, String> {
    let connections = state.connections.lock().map_err(|e| e.to_string())?;
    let conn = connections.get(&server_id)
        .ok_or_else(|| "未找到活跃连接，请先连接".to_string())?;

    conn.exec_command(&command).map_err(|e| format!("命令执行失败: {}", e))
}

// ==================== SFTP 命令 ====================

#[tauri::command]
pub fn list_dir(
    state: State<AppState>,
    server_id: i64,
    path: String,
) -> Result<Vec<RemoteFileInfo>, String> {
    let connections = state.connections.lock().map_err(|e| e.to_string())?;
    let conn = connections.get(&server_id)
        .ok_or_else(|| "未找到活跃连接，请先连接".to_string())?;

    conn.list_dir(&path).map_err(|e| format!("列出目录失败: {}", e))
}

// ==================== 监控命令 ====================

#[tauri::command]
pub fn get_server_status(state: State<AppState>, server_id: i64) -> Result<ServerStatus, String> {
    let connections = state.connections.lock().map_err(|e| e.to_string())?;
    let conn = connections.get(&server_id)
        .ok_or_else(|| "未找到活跃连接，请先连接".to_string())?;

    monitor::get_remote_server_status(conn, server_id)
        .map_err(|e| format!("获取状态失败: {}", e))
}

// ==================== 配置导入/导出 ====================

#[tauri::command]
pub fn export_config(state: State<AppState>) -> Result<ConfigExport, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.export_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_config(state: State<AppState>, config: ConfigExport) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.import_config(&config).map_err(|e| e.to_string())
}
