use serde::{Deserialize, Serialize};

/// 服务器分组
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerGroup {
    pub id: Option<i64>,
    pub name: String,
    pub sort_order: i32,
}

/// 认证方式
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AuthType {
    Key,  // 密钥认证
    Password,  // 密码认证
}

/// SSH 服务器配置
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Server {
    pub id: Option<i64>,
    pub group_id: Option<i64>,
    pub name: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub private_key_path: Option<String>,
    pub password: Option<String>,
    pub sort_order: i32,
}

fn default_port() -> u16 {
    22
}

/// 服务器状态（实时监控数据）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerStatus {
    pub server_id: i64,
    pub online: bool,
    pub cpu_usage: f64,      // CPU 使用率百分比（总）
    pub cpu_cores: Vec<f64>, // 每个逻辑核心的使用率
    pub memory_usage: f64,   // 内存使用率百分比
    pub memory_total: u64,   // 总内存 (bytes)
    pub memory_used: u64,    // 已用内存 (bytes)
    pub network_rx: u64,     // 网络接收 (bytes)
    pub network_tx: u64,     // 网络发送 (bytes)
    pub disk_usage: f64,     // 磁盘使用率百分比
    pub last_checked: String, // ISO 8601 时间戳
}

/// 导入/导出用的配置结构
#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigExport {
    pub version: String,
    pub groups: Vec<ServerGroup>,
    pub servers: Vec<Server>,
}
