import { useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { ServerGroup, Server } from '../types';
import ContextMenu from './ContextMenu';

interface ServerListProps {
  groups: ServerGroup[];
  servers: Server[];
  activeServerId: number | null;
  serverStatuses: Record<number, boolean>;
  onSelectServer: (serverId: number, serverName: string) => void;
  onDoubleClickServer: (serverId: number, serverName: string) => void;
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

  const groupedServers = useMemo(() => {
    const grouped: { group: ServerGroup | null; servers: Server[] }[] = [];

    for (const group of groups) {
      const groupServers = servers.filter(
        (s) => s.group_id === group.id,
      );
      grouped.push({ group, servers: groupServers });
    }

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
      <div className="flex-1 flex flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
        <p>暂无服务器</p>
        <p className="text-xs opacity-60">点击上方按钮添加服务器</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {groupedServers.map(({ group, servers: groupServers }) => (
        <div key={group?.id ?? 'ungrouped'} className="mb-1">
          {group && (
            <div className="flex items-center justify-between px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/50 group">
              <span className="truncate">{group.name}</span>
              <div className="hidden group-hover:flex gap-1">
                <button
                  className="p-0.5 rounded hover:bg-accent"
                  onClick={(e) => { e.stopPropagation(); onRenameGroup(group.id!, group.name); }}
                  title="重命名"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  className="p-0.5 rounded hover:bg-destructive/20 text-destructive"
                  onClick={(e) => { e.stopPropagation(); onDeleteGroup(group.id!); }}
                  title="删除"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
          {groupServers.map((server) => {
            const isOnline = server.id !== null && serverStatuses[server.id];

            return (
              <div
                key={server.id}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/50 ${
                  activeServerId === server.id ? 'bg-accent/50' : ''
                }`}
                onClick={() => server.id && onSelectServer(server.id, server.name)}
                onDoubleClick={() => server.id && onDoubleClickServer(server.id, server.name)}
                onContextMenu={(e) => handleContextMenu(e, server)}
              >
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isOnline ? 'bg-green-500' : 'bg-gray-500'
                  }`}
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm truncate">{server.name}</span>
                  <span className="text-xs text-muted-foreground truncate">{server.host}</span>
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
