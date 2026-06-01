use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::Result;

mod commands;
mod crypto;
mod db;
mod models;
mod monitor;
mod ssh;

use commands::AppState;

/// 初始化数据库并返回 AppState
fn init_state() -> Result<AppState> {
    // 数据库文件放在 Tauri 的 app data 目录
    // 开发阶段使用相对路径方便调试
    let db_path = if cfg!(debug_assertions) {
        // 开发模式：放在项目根目录
        let mut path = std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."));
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
        .run(tauri::generate_context!())
        .expect("启动 Linx 失败");
}
