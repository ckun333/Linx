import { useCallback } from 'react';

interface ReconnectDialogProps {
  open: boolean;
  serverName: string;
  onOpenNewTab: () => void;
  onReconnect: () => void;
  onCancel: () => void;
}

function ReconnectDialog({ open, serverName, onOpenNewTab, onReconnect, onCancel }: ReconnectDialogProps) {
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  }, [onCancel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  }, [onCancel]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
      <div className="modal">
        <div className="modal-header">
          <h3>服务器已连接</h3>
          <button className="modal-close-btn" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            「{serverName}」已有活跃连接，请选择操作：
          </p>
        </div>
        <div className="modal-footer" style={{ flexDirection: 'column', gap: 8 }}>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={onOpenNewTab}>
            打开新窗口
          </button>
          <button className="btn" style={{ width: '100%' }} onClick={onReconnect}>
            断开并重新连接
          </button>
          <button className="btn" style={{ width: '100%' }} onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReconnectDialog;
