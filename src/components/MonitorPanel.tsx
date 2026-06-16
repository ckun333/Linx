import { useState, useEffect, useCallback, useRef } from 'react';
import { Cpu, HardDrive, Wifi, Activity, Server } from 'lucide-react';
import { Badge } from './ui/badge';
import { ServerStatus } from '../types';
import { getServerStatus } from '../hooks/useTauri';
import { useToast } from '../contexts/ToastContext';

interface MonitorPanelProps {
  serverId: number | null;
  refreshKey?: number;
  connectedServerId?: number | null;
}

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

    prevNetworkRx.current = null;
    prevNetworkTx.current = null;
    prevNetworkTime.current = null;
    setNetworkRxSpeed(null);
    setNetworkTxSpeed(null);

    fetchStatus();
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

  const getBarColor = (percent: number) => {
    if (percent > 80) return 'bg-red-500';
    if (percent > 50) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  if (serverId === null || serverId !== connectedServerId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <h3 className="text-sm font-medium">监控</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          选择服务器查看状态
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h3 className="text-sm font-medium">监控</h3>
        <span className="text-xs text-muted-foreground">
          {currentTime.toLocaleTimeString('zh-CN')}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        )}

        {loading && !status && (
          <div className="text-sm text-muted-foreground text-center py-4">获取中...</div>
        )}

        {status && (
          <>
            {/* Status */}
            <div className="p-3 rounded-lg border border-border bg-secondary/50">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Server className="w-4 h-4" />
                状态
              </div>
              <Badge variant={status.online ? "default" : "destructive"}>
                {status.online ? '在线' : '离线'}
              </Badge>
            </div>

            {/* CPU */}
            <div className="p-3 rounded-lg border border-border bg-secondary/50">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Cpu className="w-4 h-4" />
                CPU（总计 {status.cpu_usage.toFixed(1)}%）
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full transition-all ${getBarColor(status.cpu_usage)}`}
                  style={{ width: `${Math.min(status.cpu_usage, 100)}%` }}
                />
              </div>
              {status.cpu_cores.map((usage, i) => (
                <div key={i} className="mb-1">
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                    <span>CPU {i}</span>
                    <span>{usage.toFixed(1)}%</span>
                  </div>
                  <div className="h-[3px] rounded-full bg-secondary overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${getBarColor(usage)}`}
                      style={{ width: `${Math.min(usage, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Memory */}
            <div className="p-3 rounded-lg border border-border bg-secondary/50">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Activity className="w-4 h-4" />
                内存
              </div>
              <div className="text-sm mb-2">
                {formatBytes(status.memory_used)} / {formatBytes(status.memory_total)}
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${getBarColor(status.memory_usage)}`}
                  style={{ width: `${Math.min(status.memory_usage, 100)}%` }}
                />
              </div>
            </div>

            {/* Disk */}
            <div className="p-3 rounded-lg border border-border bg-secondary/50">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <HardDrive className="w-4 h-4" />
                磁盘
              </div>
              <div className="text-sm mb-2">
                {status.disk_usage.toFixed(1)}%
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${getBarColor(status.disk_usage)}`}
                  style={{ width: `${Math.min(status.disk_usage, 100)}%` }}
                />
              </div>
            </div>

            {/* Network */}
            <div className="p-3 rounded-lg border border-border bg-secondary/50">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Wifi className="w-4 h-4" />
                网络
              </div>
              <div className="flex justify-between text-sm">
                <span>↓ {networkRxSpeed !== null ? formatSpeed(networkRxSpeed) : '—'}</span>
                <span>↑ {networkTxSpeed !== null ? formatSpeed(networkTxSpeed) : '—'}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MonitorPanel;
