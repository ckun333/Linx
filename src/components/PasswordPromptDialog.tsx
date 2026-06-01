import { useState, useCallback } from 'react';

interface PasswordPromptServer {
  id: number | null;
  name: string;
  host: string;
}

interface PasswordPromptDialogProps {
  open: boolean;
  servers: PasswordPromptServer[];
  onClose: () => void;
  onConfirm: (passwords: Record<string, string>) => void; // key is server id as string
}

/**
 * 导入配置时密码提示对话框
 *
 * 对每个没有密码的服务器显示密码输入框和跳过选项
 */
function PasswordPromptDialog({ open, servers, onClose, onConfirm }: PasswordPromptDialogProps) {
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  const handleConfirm = useCallback(() => {
    const result: Record<string, string> = {};

    for (const server of servers) {
      const key = String(server.id ?? server.name);
      if (!skipped[key] && passwords[key]?.trim()) {
        result[key] = passwords[key];
      }
    }

    onConfirm(result);
    onClose();
  }, [servers, passwords, skipped, onConfirm, onClose]);

  const updatePassword = useCallback((key: string, value: string) => {
    setPasswords((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleSkip = useCallback((key: string) => {
    setSkipped((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
      <div className="modal">
        <div className="modal-header">
          <h3>请输入服务器密码</h3>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            以下服务器导入配置中不包含密码，请输入密码或跳过。
          </p>

          <div className="password-prompt-list">
            {servers.map((server) => {
              const key = String(server.id ?? server.name);
              return (
                <div key={key} className="password-prompt-item">
                  <div className="password-prompt-item-header">
                    <div>
                      <div className="password-prompt-server-name">{server.name}</div>
                      <div className="password-prompt-server-host">{server.host}</div>
                    </div>
                    <label className="password-prompt-skip">
                      <input
                        type="checkbox"
                        checked={!!skipped[key]}
                        onChange={() => toggleSkip(key)}
                      />
                      跳过
                    </label>
                  </div>
                  {!skipped[key] && (
                    <input
                      className="form-input"
                      type="password"
                      value={passwords[key] ?? ''}
                      onChange={(e) => updatePassword(key, e.target.value)}
                      placeholder="输入密码"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            取消导入
          </button>
          <button className="btn btn-primary" onClick={handleConfirm}>
            确认导入
          </button>
        </div>
      </div>
    </div>
  );
}

export default PasswordPromptDialog;
