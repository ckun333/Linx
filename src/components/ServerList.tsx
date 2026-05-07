import { useMemo } from 'react';
import { ServerGroup, Server } from '../types';

interface ServerListProps {
  groups: ServerGroup[];
  servers: Server[];
  activeServerId: number | null;
  onSelectServer: (serverId: number) => void;
  onRefresh: () => void;
}

/**
 * 服务器列表组件
 *
 * 按分组展示服务器，点击可选中并打开终端
 */
function ServerList({
  groups,
  servers,
  activeServerId,
  onSelectServer,
}: ServerListProps) {
  // 按分组整理服务器列表
  const groupedServers = useMemo(() => {
    const grouped: { group: ServerGroup | null; servers: Server[] }[] = [];

    // 有分组的服务器
    for (const group of groups) {
      const groupServers = servers.filter(
        (s) => s.group_id === group.id,
      );
      if (groupServers.length > 0) {
        grouped.push({ group, servers: groupServers });
      }
    }

    // 未分组的服务器
    const ungroupedServers = servers.filter((s) => s.group_id === null);
    if (ungroupedServers.length > 0) {
      grouped.push({ group: null, servers: ungroupedServers });
    }

    return grouped;
  }, [groups, servers]);

  if (servers.length === 0) {
    return (
      <div className="server-list-empty">
        <p>暂无服务器</p>
        <p className="hint">在设置中添加服务器</p>
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
            </div>
          )}
          {groupServers.map((server) => (
            <div
              key={server.id}
              className={`server-item ${activeServerId === server.id ? 'active' : ''}`}
              onClick={() => server.id && onSelectServer(server.id)}
            >
              <div className="server-status-dot" />
              <div className="server-info">
                <span className="server-name">{server.name}</span>
                <span className="server-host">{server.host}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default ServerList;
