use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::Result;
use tauri::{AppHandle, Emitter, State};

use crate::db::Database;
use crate::models::{AuthType, ConfigExport, Server, ServerGroup, ServerStatus};
use crate::monitor;
use crate::monitor::CpuTickSnapshot;
use crate::ssh::{InteractiveShell, RemoteFileInfo, SshConnection};

pub(crate) struct ServerCredentials {
    host: String,
    port: u16,
    username: String,
    auth_type: AuthType,
    private_key_path: Option<String>,
    password: Option<String>,
}

pub struct AppState {
    pub db: Mutex<Database>,
    pub connections: Mutex<HashMap<i64, Arc<SshConnection>>>,
    pub shells: Mutex<HashMap<String, InteractiveShell>>,
    pub prev_cpu_stats: Mutex<HashMap<i64, CpuTickSnapshot>>,
    pub server_creds: Mutex<HashMap<i64, ServerCredentials>>,
    pub monitor_connections: Mutex<HashMap<i64, Arc<SshConnection>>>,
}

// ==================== 分组命令 ====================

#[tauri::command(rename_all = "camelCase")]
pub fn get_groups(state: State<'_, AppState>) -> Result<Vec<ServerGroup>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_groups().map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_group(state: State<'_, AppState>, name: String, sort_order: i32) -> Result<ServerGroup, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let group = ServerGroup { id: None, name, sort_order };
    db.create_group(&group).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_group(state: State<'_, AppState>, id: i64, name: String, sort_order: i32) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let group = ServerGroup { id: Some(id), name, sort_order };
    db.update_group(&group).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_group(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_group(id).map_err(|e| e.to_string())
}

// ==================== 服务器命令 ====================

#[tauri::command(rename_all = "camelCase")]
pub fn get_servers(state: State<'_, AppState>) -> Result<Vec<Server>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_servers().map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_server_for_edit(state: State<'_, AppState>, id: i64) -> Result<Server, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_server_by_id(id).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn check_server_connectivity(host: String, port: u16) -> Result<bool, String> {
    let addr = format!("{}:{}", host, port);
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        tokio::net::TcpStream::connect(&addr),
    )
    .await;
    match result {
        Ok(Ok(_)) => Ok(true),
        _ => Ok(false),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_server(
    state: State<'_, AppState>,
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
        "key" => crate::models::AuthType::Key,
        _ => crate::models::AuthType::Password,
    };
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let server = Server {
        id: None, group_id, name, host, port, username,
        auth_type, private_key_path, password, sort_order,
    };
    db.create_server(&server).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_server(
    state: State<'_, AppState>,
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
        "key" => crate::models::AuthType::Key,
        _ => crate::models::AuthType::Password,
    };
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let server = Server {
        id: Some(id), group_id, name, host, port, username,
        auth_type, private_key_path, password, sort_order,
    };
    db.update_server(&server).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_server(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_server(id).map_err(|e| e.to_string())
}

// ==================== SSH 连接命令（核心异步）====================

#[tauri::command(rename_all = "camelCase")]
pub async fn connect_ssh(
    state: State<'_, AppState>,
    server_id: i64,
) -> Result<String, String> {
    let (host, port, username, auth_type, private_key_path, password) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let servers = db.get_all_servers().map_err(|e| e.to_string())?;
        let server = servers.into_iter().find(|s| s.id == Some(server_id))
            .ok_or_else(|| "未找到服务器".to_string())?;
        let decrypted_password = db.get_server_password(server_id).map_err(|e| e.to_string())?;
        let auth_type = match server.auth_type {
            crate::models::AuthType::Key => crate::models::AuthType::Key,
            crate::models::AuthType::Password => crate::models::AuthType::Password,
        };
        (server.host, server.port, server.username, auth_type, server.private_key_path, decrypted_password)
    };

    let host_clone = host.clone();
    let conn = tokio::task::spawn_blocking(move || {
        SshConnection::connect(server_id, &host, port, &username, &auth_type, &private_key_path, &password)
    })
    .await
    .map_err(|e| format!("线程池错误: {}", e))?
    .map_err(|e| format!("SSH 连接失败: {}", e))?;

    let mut connections = state.connections.lock().map_err(|e| e.to_string())?;
    connections.insert(server_id, Arc::new(conn));
    Ok(format!("已连接到 {}", host_clone))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn disconnect_ssh(state: State<'_, AppState>, session_id: String, server_id: i64) -> Result<String, String> {
    let old_shell = {
        let mut shells = state.shells.lock().map_err(|e| e.to_string())?;
        shells.remove(&session_id)
    };
    if let Some(mut shell) = old_shell {
        tokio::task::spawn_blocking(move || { shell.close().ok(); }).await.ok();
    }

    let has_other_sessions = {
        let shells = state.shells.lock().map_err(|e| e.to_string())?;
        shells.values().any(|s| s.server_id == server_id)
    };

    if !has_other_sessions {
        let old_conn = {
            let mut connections = state.connections.lock().map_err(|e| e.to_string())?;
            connections.remove(&server_id)
        };
        if let Some(conn) = old_conn {
            tokio::task::spawn_blocking(move || { conn.disconnect().ok(); }).await.ok();
        }

        {
            let mut stats = state.prev_cpu_stats.lock().map_err(|e| e.to_string())?;
            stats.remove(&server_id);
        }
        {
            let mut conns = state.monitor_connections.lock().map_err(|e| e.to_string())?;
            conns.remove(&server_id);
        }
        {
            let mut creds = state.server_creds.lock().map_err(|e| e.to_string())?;
            creds.remove(&server_id);
        }
    }

    Ok("已断开连接".to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn exec_ssh(state: State<'_, AppState>, server_id: i64, command: String) -> Result<String, String> {
    let conn_arc = {
        let connections = state.connections.lock().map_err(|e| e.to_string())?;
        connections.get(&server_id)
            .cloned()
            .ok_or_else(|| "未找到活跃连接，请先连接".to_string())?
    };
    tokio::task::spawn_blocking(move || {
        conn_arc.exec_command(&command).map_err(|e| format!("命令执行失败: {}", e))
    })
    .await
    .map_err(|e| format!("线程池错误: {}", e))?
}

// ==================== PTY 交互式终端命令 ====================

#[derive(Clone, serde::Serialize)]
struct TerminalOutputPayload {
    session_id: String,
    server_id: i64,
    data: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_shell(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    server_id: i64,
) -> Result<String, String> {
    let old_shell = {
        let mut shells = state.shells.lock().map_err(|e| e.to_string())?;
        shells.remove(&session_id)
    };
    if let Some(mut old) = old_shell {
        tokio::task::spawn_blocking(move || { old.close().ok(); }).await.ok();
    }

    let (host, port, username, auth_type, private_key_path, password) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let servers = db.get_all_servers().map_err(|e| e.to_string())?;
        let server = servers.into_iter().find(|s| s.id == Some(server_id))
            .ok_or_else(|| "未找到服务器".to_string())?;
        let decrypted_password = db.get_server_password(server_id).map_err(|e| e.to_string())?;
        let auth_type = match server.auth_type {
            AuthType::Key => AuthType::Key,
            AuthType::Password => AuthType::Password,
        };
        (server.host, server.port, server.username, auth_type, server.private_key_path, decrypted_password)
    };

    // 保存凭证供监控连接使用
    {
        let mut creds = state.server_creds.lock().map_err(|e| e.to_string())?;
        creds.insert(server_id, ServerCredentials {
            host: host.clone(),
            port,
            username: username.clone(),
            auth_type: auth_type.clone(),
            private_key_path: private_key_path.clone(),
            password: password.clone(),
        });
    }

    let mut shell = tokio::task::spawn_blocking(move || {
        InteractiveShell::connect(server_id, &host, port, &username, &auth_type, &private_key_path, &password)
    })
    .await
    .map_err(|e| format!("线程池错误: {}", e))?
    .map_err(|e| format!("SSH shell 连接失败: {}", e))?;

    let output_rx = shell.take_output_rx();
    {
        let mut shells = state.shells.lock().map_err(|e| e.to_string())?;
        shells.insert(session_id.clone(), shell);
    }

    let app_clone = app.clone();
    let session_id_clone = session_id.clone();
    thread::Builder::new()
        .name(format!("shell-event-{}", session_id))
        .spawn(move || {
            loop {
                match output_rx.recv() {
                    Ok(data) => {
                        if let Ok(text) = String::from_utf8(data) {
                            let _ = app_clone.emit("terminal-output", TerminalOutputPayload {
                                session_id: session_id_clone.clone(),
                                server_id,
                                data: text,
                            });
                        }
                    }
                    Err(_) => break,
                }
            }
        })
        .map_err(|e| format!("启动事件线程失败: {}", e))?;

    Ok("shell 已启动".to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn write_ssh(state: State<'_, AppState>, session_id: String, data: String) -> Result<(), String> {
    let shells = state.shells.lock().map_err(|e| e.to_string())?;
    let shell = shells.get(&session_id)
        .ok_or_else(|| "未找到活跃 shell 会话".to_string())?;
    shell.write_stdin(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn resize_ssh(state: State<'_, AppState>, session_id: String, cols: u32, rows: u32) -> Result<(), String> {
    let shells = state.shells.lock().map_err(|e| e.to_string())?;
    let shell = shells.get(&session_id)
        .ok_or_else(|| "未找到活跃 shell 会话".to_string())?;
    shell.resize_pty(cols, rows).map_err(|e| e.to_string())
}

// ==================== SFTP 命令 ====================

#[tauri::command(rename_all = "camelCase")]
pub fn list_dir(
    state: State<'_, AppState>,
    server_id: i64,
    path: String,
) -> Result<Vec<RemoteFileInfo>, String> {
    let connections = state.connections.lock().map_err(|e| e.to_string())?;
    let conn = connections.get(&server_id)
        .ok_or_else(|| "未找到活跃连接，请先连接".to_string())?;
    conn.list_dir(&path).map_err(|e| format!("列出目录失败: {}", e))
}

// ==================== 监控命令 ====================

#[tauri::command(rename_all = "camelCase")]
pub async fn get_server_status(state: State<'_, AppState>, server_id: i64) -> Result<ServerStatus, String> {
    // Phase 1: 提取凭证和已有连接（非阻塞，快速）
    let (creds, existing_conn_opt) = {
        let creds_map = state.server_creds.lock().map_err(|e| e.to_string())?;
        let cred = creds_map.get(&server_id)
            .ok_or_else(|| "未找到服务器凭证，请先连接".to_string())?;
        let creds = ServerCredentials {
            host: cred.host.clone(),
            port: cred.port,
            username: cred.username.clone(),
            auth_type: cred.auth_type.clone(),
            private_key_path: cred.private_key_path.clone(),
            password: cred.password.clone(),
        };
        let monitor_conns = state.monitor_connections.lock().map_err(|e| e.to_string())?;
        let existing = monitor_conns.get(&server_id).cloned();
        (creds, existing)
    };

    // Phase 2: SSH I/O（在 spawn_blocking 中执行，不阻塞主线程）
    let io_result = tokio::task::spawn_blocking(move || -> Result<(String, String, String, String, Arc<SshConnection>), String> {
        // 尝试复用已有连接，否则新建
        let conn: Arc<SshConnection> = match existing_conn_opt {
            Some(ref c) if c.exec_command("echo ok").is_ok() => c.clone(),
            _ => Arc::new(
                SshConnection::connect(
                    server_id, &creds.host, creds.port, &creds.username,
                    &creds.auth_type, &creds.private_key_path, &creds.password,
                ).map_err(|e| format!("创建监控连接失败: {}", e))?
            ),
        };

        let cpu = conn.exec_command("cat /proc/stat").map_err(|e| e.to_string())?;
        let mem = conn.exec_command("cat /proc/meminfo").map_err(|e| e.to_string())?;
        let net = conn.exec_command("cat /proc/net/dev | tail -n +3").map_err(|e| e.to_string())?;
        let disk = conn.exec_command("df / | tail -1 | awk '{print $5}' | sed 's/%//'").map_err(|e| e.to_string())?;

        Ok((cpu, mem, net, disk, conn))
    }).await.map_err(|e| format!("线程池错误: {}", e))?;

    let (cpu_output, mem_output, net_output, disk_output, conn_arc) = io_result?;

    // 缓存连接供下次复用
    {
        let mut monitor_conns = state.monitor_connections.lock().map_err(|e| e.to_string())?;
        monitor_conns.insert(server_id, conn_arc);
    }

    // Phase 3: 解析结果（非阻塞）
    let cur_snapshot = monitor::extract_cpu_snapshot(&cpu_output)
        .map_err(|e| format!("解析 CPU 数据失败: {}", e))?;

    let (cpu_usage, cpu_cores) = {
        let stats = state.prev_cpu_stats.lock().map_err(|e| e.to_string())?;
        match stats.get(&server_id) {
            Some(prev) => monitor::compute_cpu_delta(prev, &cur_snapshot),
            None => (0.0, vec![0.0; cur_snapshot.cores.len()]),
        }
    };

    {
        let mut stats = state.prev_cpu_stats.lock().map_err(|e| e.to_string())?;
        stats.insert(server_id, cur_snapshot);
    }

    let (memory_total, memory_used, memory_usage) = monitor::parse_memory_info(&mem_output)
        .map_err(|e| format!("解析内存数据失败: {}", e))?;
    let (network_rx, network_tx) = monitor::parse_network_stats(&net_output)
        .map_err(|e| format!("解析网络数据失败: {}", e))?;
    let disk_usage: f64 = disk_output.trim().parse().unwrap_or(0.0);

    Ok(ServerStatus {
        server_id,
        online: true,
        cpu_usage,
        cpu_cores,
        memory_usage,
        memory_total,
        memory_used,
        network_rx,
        network_tx,
        disk_usage,
        last_checked: chrono::Utc::now().to_rfc3339(),
    })
}

// ==================== 配置导入/导出 ====================

#[tauri::command(rename_all = "camelCase")]
pub fn export_config(state: State<'_, AppState>) -> Result<ConfigExport, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.export_config().map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn import_config(state: State<'_, AppState>, config: ConfigExport) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.import_config(&config).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn export_config_to_file(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let config = export_config(state)?;
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("写入文件失败: {}", e))
}

#[tauri::command(rename_all = "camelCase")]
pub fn import_config_from_file(_state: State<'_, AppState>, path: String) -> Result<ConfigExport, String> {
    let json = std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    let config: ConfigExport = serde_json::from_str(&json).map_err(|e| format!("解析 JSON 失败: {}", e))?;
    Ok(config)
}

#[tauri::command(rename_all = "camelCase")]
pub fn confirm_import_config(state: State<'_, AppState>, config: ConfigExport) -> Result<(), String> {
    import_config(state, config)
}
