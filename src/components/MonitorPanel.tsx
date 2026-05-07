import { useState, useEffect, useCallback, useRef } from 'react';
import { ServerStatus } from '../types';
import { getServerStatus, connectSsh } from '../hooks/useTauri';

interface MonitorPanelProps {
  serverId: number | null;
}

/**
 * 监控面板组件（右侧）
 *
 * 显示选中服务器的实时状态：
 * - CPU 使用率
 * - 内存使用情况
 * - 网络流量
 * - 磁盘使用率
 *
 * Phase 1: 基础数据展示
 * Phase 2: 图表可视化
 */
function MonitorPanel({ serverId }: MonitorPanelProps) {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (serverId === null) return;

    setLoading(true);
    setError(null);

    try {
      // 确保已连接
      await connectSsh(serverId);
      const data = await getServerStatus(serverId);
      setStatus(data);
    } catch (err) {
      setError(String(err));
      // 连接失败时停止轮询
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  // 当 serverId 变化时启动/停止轮询
  useEffect(() => {
    if (serverId === null) {
      setStatus(null);
      setError(null);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    // 立即获取一次
    fetchStatus();

    // 每 5 秒轮询
    pollingRef.current = setInterval(fetchStatus, 5000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [serverId, fetchStatus]);

  // 格式化字节数
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  // 格式化时间
  const formatTime = (iso: string): string => {
    try {
      const date = new Date(iso);
      return date.toLocaleTimeString('zh-CN');
    } catch {
      return iso;
    }
  };

  if (serverId === null) {
    return (
      <div className="monitor-panel">
        <div className="monitor-header">
          <h3>监控</h3>
        </div>
        <div className="monitor-empty">
          <p>选择服务器查看状态</p>
        </div>
      </div>
    );
  }

  return (
    <div className="monitor-panel">
      <div className="monitor-header">
        <h3>监控</h3>
        <span className="monitor-update-time">
          {status ? formatTime(status.last_checked) : ''}
        </span>
      </div>

      {error && (
        <div className="monitor-error">
          <p>获取失败</p>
          <button className="btn btn-small" onClick={fetchStatus}>
            重试
          </button>
        </div>
      )}

      {loading && !status && (
        <div className="monitor-loading">获取中...</div>
      )}

      {status && (
        <div className="monitor-content">
          {/* 在线状态 */}
          <div className="metric-card">
            <div className="metric-label">状态</div>
            <div className={`metric-value ${status.online ? 'online' : 'offline'}`}>
              {status.online ? '在线' : '离线'}
            </div>
          </div>

          {/* CPU */}
          <div className="metric-card">
            <div className="metric-label">CPU</div>
            <div className="metric-value">
              {status.cpu_usage.toFixed(1)}%
            </div>
            <div className="metric-bar">
              <div
                className={`metric-bar-fill ${status.cpu_usage > 80 ? 'danger' : status.cpu_usage > 50 ? 'warn' : 'normal'}`}
                style={{ width: `${Math.min(status.cpu_usage, 100)}%` }}
              />
            </div>
          </div>

          {/* 内存 */}
          <div className="metric-card">
            <div className="metric-label">内存</div>
            <div className="metric-value">
              {formatBytes(status.memory_used)} / {formatBytes(status.memory_total)}
            </div>
            <div className="metric-bar">
              <div
                className={`metric-bar-fill ${status.memory_usage > 80 ? 'danger' : status.memory_usage > 50 ? 'warn' : 'normal'}`}
                style={{ width: `${Math.min(status.memory_usage, 100)}%` }}
              />
            </div>
          </div>

          {/* 磁盘 */}
          <div className="metric-card">
            <div className="metric-label">磁盘</div>
            <div className="metric-value">
              {status.disk_usage.toFixed(1)}%
            </div>
            <div className="metric-bar">
              <div
                className={`metric-bar-fill ${status.disk_usage > 80 ? 'danger' : status.disk_usage > 50 ? 'warn' : 'normal'}`}
                style={{ width: `${Math.min(status.disk_usage, 100)}%` }}
              />
            </div>
          </div>

          {/* 网络 */}
          <div className="metric-card">
            <div className="metric-label">网络</div>
            <div className="metric-value network-row">
              <span>↓ {formatBytes(status.network_rx)}</span>
              <span>↑ {formatBytes(status.network_tx)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MonitorPanel;
