import { useMemo, useState } from 'react';
import { ServerGroup, Server } from '../types';
import ContextMenu from './ContextMenu';

interface ServerListProps {
  groups: ServerGroup[];
  servers: Server[];
  activeServerId: number | null;
  serverStatuses: Record<number, boolean>;
  onSelectServer: (serverId: number) => void;
  onDoubleClickServer: (serverId: number) => void;
  onRefresh: () => void;
  onEditServer: (id: number) => void;
  onDeleteServer: (id: number) => void;
  onRenameGroup: (id: number, name: string) => void;
  onDeleteGroup: (id: number) => void;
}

function ServerList({
  groups,
  servers,
  activeServerId,
  serverStatuses,
  onSelectServer,
  onDoubleClickServer,
  onEditServer,
  onDeleteServer,
  onRenameGroup,
  onDeleteGroup,
}: ServerListProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    serverId: number;
    serverName: string;
    serverHost: string;
    serverPort: number;
    serverUsername: string;
  } | null>(null);

  // 按分组整理服务器列表
  const groupedServers = useMemo(() => {
    const grouped: { group: ServerGroup | null; servers: Server[] }[] = [];

    // 分组：即使没有服务器也展示，便于用户识别
    for (const group of groups) {
      const groupServers = servers.filter(
        (s) => s.group_id === group.id,
      );
      grouped.push({ group, servers: groupServers });
    }

    // 未分组的服务器
    const ungroupedServers = servers.filter((s) => s.group_id === null);
    if (ungroupedServers.length > 0) {
      grouped.push({ group: null, servers: ungroupedServers });
    }

    return grouped;
  }, [groups, servers]);

  const handleContextMenu = (e: React.MouseEvent, server: Server) => {
    e.preventDefault();
    if (server.id === null) return;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      serverId: server.id,
      serverName: server.name,
      serverHost: server.host,
      serverPort: server.port,
      serverUsername: server.username,
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  if (servers.length === 0) {
    return (
      <div className="server-list-empty">
        <p>暂无服务器</p>
        <p className="hint">点击上方按钮添加服务器</p>
      </div>
    );
  }

  return (
    <div className="server-list">
      {groupedServers.map(({ group, servers: groupServers }) => (
        <div key={group?.id ?? 'ungrouped'} className="server-group">
          {group && (
            <div className="group-header">
              <span className="group-name">{group.name}</span>
              <div className="group-actions">
                <button
                  className="group-action-btn"
                  onClick={(e) => { e.stopPropagation(); onRenameGroup(group.id!, group.name); }}
                  title="重命名"
                >✎</button>
                <button
                  className="group-action-btn"
                  onClick={(e) => { e.stopPropagation(); onDeleteGroup(group.id!); }}
                  title="删除"
                >✕</button>
              </div>
            </div>
          )}
          {groupServers.map((server) => {
            const isOnline = server.id !== null && serverStatuses[server.id];

            return (
              <div
                key={server.id}
                className={`server-item ${activeServerId === server.id ? 'active' : ''}`}
                onClick={() => server.id && onSelectServer(server.id)}
                onDoubleClick={() => server.id && onDoubleClickServer(server.id)}
                onContextMenu={(e) => handleContextMenu(e, server)}
              >
                <div
                  className={`server-status-dot ${isOnline ? 'online' : 'offline'}`}
                />
                <div className="server-info">
                  <span className="server-name">{server.name}</span>
                  <span className="server-host">{server.host}</span>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          serverId={contextMenu.serverId}
          serverName={contextMenu.serverName}
          serverHost={contextMenu.serverHost}
          serverPort={contextMenu.serverPort}
          serverUsername={contextMenu.serverUsername}
          onClose={closeContextMenu}
          onEdit={onEditServer}
          onDelete={onDeleteServer}
        />
      )}
    </div>
  );
}

export default ServerList;
