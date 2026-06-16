import { useEffect, useCallback } from 'react';
import { Pencil, Trash2, Copy } from 'lucide-react';

interface ContextMenuProps {
  x: number;
  y: number;
  serverId: number;
  serverName: string;
  serverHost: string;
  serverPort: number;
  serverUsername: string;
  onClose: () => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
}

function ContextMenu({
  x,
  y,
  serverId,
  serverHost,
  serverPort,
  serverUsername,
  onClose,
  onEdit,
  onDelete,
}: ContextMenuProps) {
  const handleEdit = useCallback(() => {
    onEdit(serverId);
    onClose();
  }, [onEdit, serverId, onClose]);

  const handleDelete = useCallback(() => {
    onDelete(serverId);
    onClose();
  }, [onDelete, serverId, onClose]);

  const handleCopyConnection = useCallback(async () => {
    const connStr = `${serverUsername}@${serverHost}:${serverPort}`;
    try {
      await navigator.clipboard.writeText(connStr);
    } catch (err) {
      console.error('复制失败:', err);
    }
    onClose();
  }, [serverUsername, serverHost, serverPort, onClose]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.context-menu')) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 150);

  return (
    <div
      className="context-menu fixed z-50 min-w-[160px] rounded-md border border-border bg-card p-1 shadow-md"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <div
        className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-accent"
        onClick={handleEdit}
      >
        <Pencil className="w-4 h-4" />
        编辑
      </div>
      <div
        className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer text-destructive hover:bg-destructive/10"
        onClick={handleDelete}
      >
        <Trash2 className="w-4 h-4" />
        删除
      </div>
      <div className="my-1 h-px bg-border" />
      <div
        className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-accent"
        onClick={handleCopyConnection}
      >
        <Copy className="w-4 h-4" />
        复制连接信息
      </div>
    </div>
  );
}

export default ContextMenu;
