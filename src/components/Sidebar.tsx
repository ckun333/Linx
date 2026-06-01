import { useState, useEffect, useCallback } from 'react';
import ServerList from './ServerList';
import { ServerGroup, Server } from '../types';
import * as api from '../hooks/useTauri';
import type { ConfigExport } from '../types';
import PasswordPromptDialog from './PasswordPromptDialog';

interface SidebarProps {
  activeServerId: number | null;
  onSelectServer: (serverId: number) => void;
  onDoubleClickServer: (serverId: number) => void;
  refreshKey?: number;
  onAddServer: () => void;
  onEditServer: (id: number) => void;
  onAddGroup: () => void;
  onRenameGroup: (id: number, name: string) => void;
  onDeleteGroup: (id: number) => void;
}

function Sidebar({
  activeServerId,
  onSelectServer,
  onDoubleClickServer,
  refreshKey,
  onAddServer,
  onEditServer,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
}: SidebarProps) {
  const [groups, setGroups] = useState<ServerGroup[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverStatuses, setServerStatuses] = useState<Record<number, boolean>>({});

  const [passwordPrompt, setPasswordPrompt] = useState<{
    open: boolean;
    servers: Array<{ id: number | null; name: string; host: string }>;
    configData: ConfigExport | null;
  }>({ open: false, servers: [], configData: null });

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
  }, [loadData, refreshKey]);

  useEffect(() => {
    if (servers.length === 0) return;

    const checkStatuses = async () => {
      const statuses: Record<number, boolean> = {};
      const results = await Promise.allSettled(
        servers.map(async (s) => {
          if (s.id === null) return;
          const online = await api.checkServerConnectivity(s.host, s.port);
          statuses[s.id] = online;
        }),
      );
      for (let i = 0; i < servers.length; i++) {
        const server = servers[i];
        if (server.id === null) continue;
        if (results[i]?.status === 'rejected') {
          statuses[server.id] = false;
        }
      }
      setServerStatuses((prev) => ({ ...prev, ...statuses }));
    };

    checkStatuses();
    const interval = setInterval(checkStatuses, 10000);
    return () => clearInterval(interval);
  }, [servers]);

  const handleExport = useCallback(async () => {
    try {
      const success = await api.exportConfigToFile();
      if (success) {
        console.log('配置导出成功');
      }
    } catch (err) {
      console.error('导出配置失败:', err);
    }
  }, []);

  const handleImport = useCallback(async () => {
    try {
      const result = await api.importConfigFromFile();
      if (!result.config) return;

      if (result.serversWithoutPassword.length > 0) {
        setPasswordPrompt({
          open: true,
          servers: result.serversWithoutPassword,
          configData: result.config,
        });
      } else {
        await api.confirmImportConfig(result.config);
        loadData();
      }
    } catch (err) {
      console.error('导入配置失败:', err);
      alert('导入配置失败: ' + String(err));
    }
  }, [loadData]);

  const handlePasswordConfirm = useCallback(
    async (passwords: Record<string, string>) => {
      if (!passwordPrompt.configData) return;

      try {
        const updatedServers = passwordPrompt.configData.servers.map((s) => {
          const key = String(s.id ?? s.name);
          if (s.auth_type === 'password' && !s.password && passwords[key]) {
            return { ...s, password: passwords[key] };
          }
          return s;
        });

        const updatedConfig: ConfigExport = {
          ...passwordPrompt.configData,
          servers: updatedServers,
        };

        await api.confirmImportConfig(updatedConfig);
        loadData();
      } catch (err) {
        console.error('导入配置失败:', err);
        alert('导入配置失败: ' + String(err));
      }
    },
    [passwordPrompt.configData, loadData],
  );

  const handleDeleteServer = useCallback(
    (_id: number) => {
      loadData();
    },
    [loadData],
  );

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>服务器</h2>
        <button className="icon-btn" onClick={loadData} title="刷新">
          ↻
        </button>
      </div>

      <div className="sidebar-toolbar">
        <button className="toolbar-btn" onClick={onAddServer}>
          <span className="toolbar-btn-icon">+</span>
          服务器
        </button>
        <button className="toolbar-btn" onClick={onAddGroup}>
          <span className="toolbar-btn-icon">+</span>
          分组
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
          serverStatuses={serverStatuses}
          onSelectServer={onSelectServer}
          onDoubleClickServer={onDoubleClickServer}
          onRefresh={loadData}
          onEditServer={onEditServer}
          onDeleteServer={handleDeleteServer}
          onRenameGroup={onRenameGroup}
          onDeleteGroup={onDeleteGroup}
        />
      )}

      <div className="sidebar-footer">
        <button className="footer-btn" onClick={handleExport}>
          导出
        </button>
        <button className="footer-btn" onClick={handleImport}>
          导入
        </button>
      </div>

      <PasswordPromptDialog
        open={passwordPrompt.open}
        servers={passwordPrompt.servers}
        onClose={() => setPasswordPrompt({ open: false, servers: [], configData: null })}
        onConfirm={handlePasswordConfirm}
      />
    </div>
  );
}

export default Sidebar;
