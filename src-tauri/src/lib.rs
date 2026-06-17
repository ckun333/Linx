use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::Result;
use tauri::Listener;
use tauri::Manager;

mod commands;
mod crypto;
mod db;
mod models;
mod monitor;
mod ssh;

use commands::AppState;

/// 初始化数据库并返回 AppState
fn init_state() -> Result<AppState> {
    let db_path = if cfg!(debug_assertions) {
        // 开发模式：放在项目根目录（不在 src-tauri 内，避免 watcher 触发重建）
        let mut path = std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."));
        path.pop(); // src-tauri/ → 项目根目录
        path.push("linx_dev.db");
        path.to_string_lossy().to_string()
    } else {
        // 生产模式：使用 Tauri 的 app data 目录
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        format!("{}/.linx/linx.db", home)
    };

    // 确保目录存在
    if let Some(parent) = std::path::Path::new(&db_path).parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let database = db::Database::new(&db_path)?;

    Ok(AppState {
        db: Mutex::new(database),
        connections: Mutex::new(HashMap::new()),
        shells: Mutex::new(HashMap::new()),
        prev_cpu_stats: Mutex::new(HashMap::new()),
        server_creds: Mutex::new(HashMap::new()),
        monitor_connections: Mutex::new(HashMap::new()),
    })
}

/// 运行 Tauri 应用
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = init_state().expect("初始化应用状态失败");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            // 分组
            commands::get_groups,
            commands::create_group,
            commands::update_group,
            commands::delete_group,
            // 服务器
            commands::get_servers,
            commands::get_server_for_edit,
            commands::check_server_connectivity,
            commands::create_server,
            commands::update_server,
            commands::delete_server,
            // SSH
            commands::connect_ssh,
            commands::disconnect_ssh,
            commands::exec_ssh,
            // PTY Shell
            commands::start_shell,
            commands::write_ssh,
            commands::resize_ssh,
            // SFTP
            commands::list_dir,
            // 监控
            commands::get_server_status,
            // 配置
            commands::export_config,
            commands::import_config,
            commands::export_config_to_file,
            commands::import_config_from_file,
            commands::confirm_import_config,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            handle.clone().listen("terminal-input", move |event| {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                    let session_id = payload["sessionId"].as_str().unwrap_or("");
                    let data = payload["data"].as_str().unwrap_or("");
                    if data.is_empty() || session_id.is_empty() {
                        return;
                    }
                    if let Ok(shells) = handle.state::<AppState>().shells.lock() {
                        if let Some(shell) = shells.get(session_id) {
                            let _ = shell.write_stdin(data.as_bytes());
                        }
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Linx 失败");
}
