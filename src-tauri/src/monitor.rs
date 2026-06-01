use anyhow::Result;
use chrono::Utc;

use crate::models::ServerStatus;
use crate::ssh::SshConnection;

/// 通过 SSH 获取远程服务器状态（Linux 平台）
///
/// 读取 /proc/stat, /proc/meminfo, /proc/net/dev 获取系统指标
pub fn get_remote_server_status(conn: &SshConnection, server_id: i64) -> Result<ServerStatus> {
    // 并行采集各项指标
    let cpu_output = conn.exec_command(
        "cat /proc/stat | head -1"
    )?;

    let mem_output = conn.exec_command(
        "cat /proc/meminfo"
    )?;

    let net_output = conn.exec_command(
        "cat /proc/net/dev | tail -n +3"
    )?;

    let disk_output = conn.exec_command(
        "df / | tail -1 | awk '{print $5}' | sed 's/%//'"
    )?;

    // 解析 CPU 使用率
    let cpu_usage = parse_cpu_usage(&cpu_output)?;

    // 解析内存信息
    let (memory_total, memory_used, memory_usage) = parse_memory_info(&mem_output)?;

    // 解析网络流量（取所有接口总和）
    let (network_rx, network_tx) = parse_network_stats(&net_output)?;

    // 解析磁盘使用率
    let disk_usage: f64 = disk_output.trim().parse().unwrap_or(0.0);

    Ok(ServerStatus {
        server_id,
        online: true,
        cpu_usage,
        memory_usage,
        memory_total,
        memory_used,
        network_rx,
        network_tx,
        disk_usage,
        last_checked: Utc::now().to_rfc3339(),
    })
}

/// 解析 /proc/stat 的第一行（CPU 总时间）
fn parse_cpu_usage(output: &str) -> Result<f64> {
    // 格式: cpu  user nice system idle iowait irq softirq steal guest guest_nice
    let parts: Vec<&str> = output.split_whitespace().collect();
    if parts.len() < 5 {
        anyhow::bail!("无法解析 CPU 统计信息");
    }

    let user: u64 = parts.get(1).unwrap_or(&"0").parse().unwrap_or(0);
    let nice: u64 = parts.get(2).unwrap_or(&"0").parse().unwrap_or(0);
    let system: u64 = parts.get(3).unwrap_or(&"0").parse().unwrap_or(0);
    let idle: u64 = parts.get(4).unwrap_or(&"0").parse().unwrap_or(0);
    let iowait: u64 = parts.get(5).unwrap_or(&"0").parse().unwrap_or(0);
    let irq: u64 = parts.get(6).unwrap_or(&"0").parse().unwrap_or(0);
    let softirq: u64 = parts.get(7).unwrap_or(&"0").parse().unwrap_or(0);
    let steal: u64 = parts.get(8).unwrap_or(&"0").parse().unwrap_or(0);

    let total = user + nice + system + idle + iowait + irq + softirq + steal;
    let non_idle = total - idle;

    if total == 0 {
        return Ok(0.0);
    }

    Ok((non_idle as f64 / total as f64) * 100.0)
}

/// 解析 /proc/meminfo
fn parse_memory_info(output: &str) -> Result<(u64, u64, f64)> {
    let mut mem_total: u64 = 0;
    let mut mem_available: u64 = 0;
    let mut mem_free: u64 = 0;

    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }

        match parts[0] {
            "MemTotal:" => mem_total = parts[1].parse().unwrap_or(0) * 1024,
            "MemAvailable:" => mem_available = parts[1].parse().unwrap_or(0) * 1024,
            "MemFree:" => mem_free = parts[1].parse().unwrap_or(0) * 1024,
            _ => {}
        }
    }

    // 优先使用 MemAvailable，否则用 MemFree
    let available = if mem_available > 0 {
        mem_available
    } else {
        mem_free
    };

    let mem_used = mem_total.saturating_sub(available);
    let usage = if mem_total > 0 {
        (mem_used as f64 / mem_total as f64) * 100.0
    } else {
        0.0
    };

    Ok((mem_total, mem_used, usage))
}

/// 解析 /proc/net/dev（网络接口流量）
fn parse_network_stats(output: &str) -> Result<(u64, u64)> {
    let mut total_rx: u64 = 0;
    let mut total_tx: u64 = 0;

    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        // 格式: eth0: rx_bytes tx_bytes ...
        if parts.len() < 10 {
            continue;
        }

        // 跳过回环接口
        if parts[0].starts_with("lo:") {
            continue;
        }

        // rx_bytes 一般在第1列，tx_bytes在第9列
        let rx: u64 = parts.get(1).unwrap_or(&"0").parse().unwrap_or(0);
        let tx: u64 = parts.get(9).unwrap_or(&"0").parse().unwrap_or(0);

        total_rx += rx;
        total_tx += tx;
    }

    Ok((total_rx, total_tx))
}

#[cfg(target_os = "windows")]
/// Windows 平台的状态采集（占位实现）
pub fn get_local_status() -> Result<ServerStatus> {
    // 使用 sysinfo 采集本地信息
    use sysinfo::{System, Disks, Networks};

    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_usage = sys.global_cpu_info().cpu_usage() as f64;

    let memory_total = sys.total_memory();
    let memory_used = sys.used_memory();
    let memory_usage = if memory_total > 0 {
        (memory_used as f64 / memory_total as f64) * 100.0
    } else {
        0.0
    };

    // 网络统计
    let networks = Networks::new_with_refreshed_list();
    let (mut total_rx, mut total_tx) = (0, 0);
    for (_name, data) in &networks {
        total_rx += data.total_received();
        total_tx += data.total_transmitted();
    }

    // 磁盘使用率
    let disks = Disks::new_with_refreshed_list();
    let disk_usage = disks.iter().next()
        .map(|d| {
            let total = d.total_space();
            let available = d.available_space();
            if total > 0 {
                ((total - available) as f64 / total as f64) * 100.0
            } else {
                0.0
            }
        })
        .unwrap_or(0.0);

    Ok(ServerStatus {
        server_id: 0,
        online: true,
        cpu_usage,
        memory_usage,
        memory_total,
        memory_used,
        network_rx: total_rx,
        network_tx: total_tx,
        disk_usage,
        last_checked: chrono::Utc::now().to_rfc3339(),
    })
}
