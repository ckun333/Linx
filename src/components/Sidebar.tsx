import { useState, useEffect, useCallback } from 'react';
import ServerList from './ServerList';
import { ServerGroup, Server } from '../types';
import * as api from '../hooks/useTauri';

interface SidebarProps {
  activeServerId: number | null;
  onSelectServer: (serverId: number) => void;
}

/**
 * 左侧面板容器
 *
 * 包含:
 * - 服务器列表（分组展示）
 * - SFTP 文件树（占位）
 */
function Sidebar({ activeServerId, onSelectServer }: SidebarProps) {
  const [groups, setGroups] = useState<ServerGroup[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载服务器数据
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, s] = await Promise.all([
        api.getGroups(),
        api.getServers(),
      ]);
      setGroups(g);
      setServers(s);
    } catch (err) {
      setError(String(err));
      console.error('加载服务器列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>服务器</h2>
        <button className="icon-btn" onClick={loadData} title="刷新">
          ↻
        </button>
      </div>

      {loading ? (
        <div className="sidebar-loading">加载中...</div>
      ) : error ? (
        <div className="sidebar-error">
          <p>加载失败</p>
          <button onClick={loadData}>重试</button>
        </div>
      ) : (
        <ServerList
          groups={groups}
          servers={servers}
          activeServerId={activeServerId}
          onSelectServer={onSelectServer}
          onRefresh={loadData}
        />
      )}
    </div>
  );
}

export default Sidebar;
