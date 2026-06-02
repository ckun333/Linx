use anyhow::Result;
use chrono::Utc;

use crate::models::ServerStatus;
use crate::ssh::SshConnection;

/// CPU 累积 tick 快照（用于跨轮询计算差值）
#[derive(Debug, Clone)]
pub struct CpuTickSnapshot {
    /// "cpu" 行的所有 tick 值
    pub total: Vec<u64>,
    /// 每个 "cpuN" 行的 tick 值
    pub cores: Vec<Vec<u64>>,
}

/// 通过 SSH 获取远程服务器状态（Linux 平台）
///
/// 读取 /proc/stat, /proc/meminfo, /proc/net/dev 获取系统指标
/// `prev_cpu` 是上一次的 CPU tick 快照，用于计算差值得到实时 CPU 使用率
#[allow(dead_code)]
pub fn get_remote_server_status(
    conn: &SshConnection,
    server_id: i64,
    prev_cpu: Option<&CpuTickSnapshot>,
) -> Result<(ServerStatus, CpuTickSnapshot)> {
    let cpu_output = conn.exec_command(
        "cat /proc/stat"
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

    let cur_snapshot = extract_cpu_snapshot(&cpu_output)?;
    let (cpu_usage, cpu_cores) = match prev_cpu {
        Some(prev) => compute_cpu_delta(prev, &cur_snapshot),
        None => (0.0, vec![0.0; cur_snapshot.cores.len()]),
    };

    // 解析内存信息
    let (memory_total, memory_used, memory_usage) = parse_memory_info(&mem_output)?;

    // 解析网络流量（取所有接口总和）
    let (network_rx, network_tx) = parse_network_stats(&net_output)?;

    // 解析磁盘使用率
    let disk_usage: f64 = disk_output.trim().parse().unwrap_or(0.0);

    Ok((ServerStatus {
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
        last_checked: Utc::now().to_rfc3339(),
    }, cur_snapshot))
}

/// 从 /proc/stat 内容提取所有 cpu 行的 tick 值
pub fn extract_cpu_snapshot(output: &str) -> Result<CpuTickSnapshot> {
    let mut total: Option<Vec<u64>> = None;
    let mut cores: Vec<Vec<u64>> = Vec::new();

    for line in output.lines() {
        if !line.starts_with("cpu") {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }

        let ticks: Vec<u64> = parts[1..]
            .iter()
            .map(|&s| s.parse().unwrap_or(0))
            .collect();

        if line.starts_with("cpu ") {
            total = Some(ticks);
        } else if line.as_bytes().get(3).map_or(false, |&b| b.is_ascii_digit()) {
            cores.push(ticks);
        }
    }

    let total = total.ok_or_else(|| anyhow::anyhow!("未找到 cpu 总行"))?;
    if cores.is_empty() {
        anyhow::bail!("未找到 CPU 核心信息");
    }

    Ok(CpuTickSnapshot { total, cores })
}

/// 根据两次快照计算差值得到的实时 CPU 使用率
pub fn compute_cpu_delta(prev: &CpuTickSnapshot, cur: &CpuTickSnapshot) -> (f64, Vec<f64>) {
    let calc = |prev_ticks: &[u64], cur_ticks: &[u64]| -> f64 {
        let min_len = prev_ticks.len().min(cur_ticks.len());
        if min_len < 4 {
            return 0.0;
        }
        let prev_total: u64 = prev_ticks[..min_len].iter().sum();
        let cur_total: u64 = cur_ticks[..min_len].iter().sum();
        let prev_idle = prev_ticks.get(3).unwrap_or(&0);
        let cur_idle = cur_ticks.get(3).unwrap_or(&0);

        let total_delta = cur_total.saturating_sub(prev_total);
        let idle_delta = cur_idle.saturating_sub(*prev_idle);

        if total_delta == 0 {
            return 0.0;
        }
        ((total_delta - idle_delta) as f64 / total_delta as f64) * 100.0
    };

    let total_usage = calc(&prev.total, &cur.total);
    let core_usages: Vec<f64> = prev.cores.iter().zip(cur.cores.iter())
        .map(|(p, c)| calc(p, c))
        .collect();

    (total_usage, core_usages)
}

/// 解析 /proc/meminfo
pub fn parse_memory_info(output: &str) -> Result<(u64, u64, f64)> {
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
pub fn parse_network_stats(output: &str) -> Result<(u64, u64)> {
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
        cpu_cores: vec![cpu_usage],
        memory_usage,
        memory_total,
        memory_used,
        network_rx: total_rx,
        network_tx: total_tx,
        disk_usage,
        last_checked: chrono::Utc::now().to_rfc3339(),
    })
}
