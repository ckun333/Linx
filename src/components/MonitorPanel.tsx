import { useState, useEffect, useCallback, useRef } from 'react';
import { ServerStatus } from '../types';
import { getServerStatus } from '../hooks/useTauri';
import { useToast } from '../contexts/ToastContext';

interface MonitorPanelProps {
  serverId: number | null;
  refreshKey?: number;
  connectedServerId?: number | null;
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
function MonitorPanel({ serverId, refreshKey, connectedServerId }: MonitorPanelProps) {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevErrorRef = useRef<string | null>(null);
  const { showToast } = useToast();
  const prevNetworkRx = useRef<number | null>(null);
  const prevNetworkTx = useRef<number | null>(null);
  const prevNetworkTime = useRef<number | null>(null);
  const [networkRxSpeed, setNetworkRxSpeed] = useState<number | null>(null);
  const [networkTxSpeed, setNetworkTxSpeed] = useState<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 监控错误时弹出提示
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      showToast(`监控异常: ${error}`, 'error');
    }
    prevErrorRef.current = error;
  }, [error, showToast]);

  const fetchStatus = useCallback(async () => {
    if (serverId === null) return;

    setLoading(true);
    setError(null);

    try {
      const data = await getServerStatus(serverId);
      setStatus(data);

      const now = Date.now();
      if (prevNetworkRx.current !== null && prevNetworkTx.current !== null && prevNetworkTime.current !== null) {
        const dt = (now - prevNetworkTime.current) / 1000;
        if (dt > 0) {
          setNetworkRxSpeed((data.network_rx - prevNetworkRx.current) / dt);
          setNetworkTxSpeed((data.network_tx - prevNetworkTx.current) / dt);
        }
      }
      prevNetworkRx.current = data.network_rx;
      prevNetworkTx.current = data.network_tx;
      prevNetworkTime.current = now;
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  // 当 serverId 变化时启动/停止轮询
  useEffect(() => {
    if (serverId === null || serverId !== connectedServerId) {
      setStatus(null);
      setError(null);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    // 重置网络速率缓存（新服务器或刷新）
    prevNetworkRx.current = null;
    prevNetworkTx.current = null;
    prevNetworkTime.current = null;
    setNetworkRxSpeed(null);
    setNetworkTxSpeed(null);

    // 立即获取一次
    fetchStatus();

    // 每 3 秒轮询
    pollingRef.current = setInterval(fetchStatus, 3000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [serverId, fetchStatus, refreshKey, connectedServerId]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec <= 0) return '0 B/s';
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(1024));
    if (i >= units.length) return `${bytesPerSec.toFixed(1)} B/s`;
    return `${(bytesPerSec / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  if (serverId === null || serverId !== connectedServerId) {
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
          {currentTime.toLocaleTimeString('zh-CN')}
        </span>
      </div>

      {error && (
        <div className="monitor-error">
          <p>{error}</p>
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
            <div className="metric-label">CPU（总计 {status.cpu_usage.toFixed(1)}%）</div>
            <div className="metric-bar" style={{ marginBottom: 8 }}>
              <div
                className={`metric-bar-fill ${status.cpu_usage > 80 ? 'danger' : status.cpu_usage > 50 ? 'warn' : 'normal'}`}
                style={{ width: `${Math.min(status.cpu_usage, 100)}%` }}
              />
            </div>
            {status.cpu_cores.map((usage, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>
                  <span>CPU {i}</span>
                  <span>{usage.toFixed(1)}%</span>
                </div>
                <div className="metric-bar" style={{ height: 3 }}>
                  <div
                    className={`metric-bar-fill ${usage > 80 ? 'danger' : usage > 50 ? 'warn' : 'normal'}`}
                    style={{ width: `${Math.min(usage, 100)}%` }}
                  />
                </div>
              </div>
            ))}
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
              <span>↓ {networkRxSpeed !== null ? formatSpeed(networkRxSpeed) : '—'}</span>
              <span>↑ {networkTxSpeed !== null ? formatSpeed(networkTxSpeed) : '—'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MonitorPanel;
