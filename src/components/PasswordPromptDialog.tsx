import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface PasswordPromptServer {
  id: number | null;
  name: string;
  host: string;
}

interface PasswordPromptDialogProps {
  open: boolean;
  servers: PasswordPromptServer[];
  onClose: () => void;
  onConfirm: (passwords: Record<string, string>) => void;
}

function PasswordPromptDialog({ open, servers, onClose, onConfirm }: PasswordPromptDialogProps) {
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});

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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[450px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>请输入服务器密码</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            以下服务器导入配置中不包含密码，请输入密码或跳过。
          </p>

          <div className="space-y-3 max-h-[300px] overflow-y-auto">
            {servers.map((server) => {
              const key = String(server.id ?? server.name);
              return (
                <div key={key} className="space-y-2 p-3 rounded-lg border border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{server.name}</div>
                      <div className="text-xs text-muted-foreground">{server.host}</div>
                    </div>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={!!skipped[key]}
                        onChange={() => toggleSkip(key)}
                        className="rounded border-input"
                      />
                      跳过
                    </label>
                  </div>
                  {!skipped[key] && (
                    <Input
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消导入
          </Button>
          <Button onClick={handleConfirm}>
            确认导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PasswordPromptDialog;
