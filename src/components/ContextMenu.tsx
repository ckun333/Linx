import { useEffect, useCallback } from 'react';

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

  // 点击外部关闭
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

    // 延迟添加，避免触发当前右键事件
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

  // 确保菜单不超出视口
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 150);

  return (
    <div
      className="context-menu"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <div className="context-menu-item" onClick={handleEdit}>
        编辑
      </div>
      <div className="context-menu-item danger" onClick={handleDelete}>
        删除
      </div>
      <div className="context-menu-separator" />
      <div className="context-menu-item" onClick={handleCopyConnection}>
        复制连接信息
      </div>
    </div>
  );
}

export default ContextMenu;
