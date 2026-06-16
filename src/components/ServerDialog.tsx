import { useState, useEffect, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { getServerForEdit, createServer, updateServer, deleteServer, getGroups } from '../hooks/useTauri';
import type { Server, ServerGroup, AuthType } from '../types';

interface ServerDialogProps {
  open: boolean;
  serverId: number | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: (id: number) => void;
}

function ServerDialog({ open, serverId, onClose, onSaved, onDeleted }: ServerDialogProps) {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<AuthType>('password');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [groupId, setGroupId] = useState<number | null>(null);
  const [groups, setGroups] = useState<ServerGroup[]>([]);
  const [hasExistingPassword, setHasExistingPassword] = useState(false);

  const isEdit = serverId !== null;

  useEffect(() => {
    if (!open) return;

    getGroups().then(setGroups).catch(() => {});

    if (serverId === null) {
      setName('');
      setHost('');
      setPort('22');
      setUsername('');
      setAuthType('password');
      setPassword('');
      setPrivateKeyPath('');
      setGroupId(null);
      setErrors({});
      setHasExistingPassword(false);
      return;
    }

    setLoading(true);
    setErrors({});
    getServerForEdit(serverId)
      .then((server: Server) => {
        setName(server.name);
        setHost(server.host);
        setPort(String(server.port));
        setUsername(server.username);
        setAuthType(server.auth_type);
        setPrivateKeyPath(server.private_key_path ?? '');
        setGroupId(server.group_id);
        setHasExistingPassword(!!server.password);
        setPassword('');
      })
      .catch((err) => {
        console.error('加载服务器信息失败:', err);
        setErrors({ form: '加载服务器信息失败: ' + String(err) });
      })
      .finally(() => setLoading(false));
  }, [open, serverId]);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = '服务器名称不能为空';
    if (!host.trim()) newErrors.host = '主机地址不能为空';
    if (!username.trim()) newErrors.username = '用户名不能为空';
    if (!port.trim() || isNaN(Number(port)) || Number(port) <= 0) newErrors.port = '端口号无效';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, host, username, port]);

  const handleSave = useCallback(async () => {
    if (!validate()) return;

    setSaving(true);
    try {
      const payload = {
        groupId,
        name: name.trim(),
        host: host.trim(),
        port: Number(port),
        username: username.trim(),
        authType,
        privateKeyPath: authType === 'key' ? privateKeyPath.trim() || null : null,
        password: authType === 'password' ? password || null : null,
      };

      if (isEdit && serverId !== null) {
        await updateServer({ id: serverId, ...payload });
      } else {
        await createServer(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error('保存服务器失败:', err);
      setErrors({ form: '保存失败: ' + String(err) });
    } finally {
      setSaving(false);
    }
  }, [validate, groupId, name, host, port, username, authType, privateKeyPath, password, isEdit, serverId, onSaved, onClose]);

  const handleDelete = useCallback(async () => {
    if (serverId === null) return;
    if (!window.confirm(`确定要删除服务器「${name}」吗？此操作不可恢复。`)) return;

    try {
      await deleteServer(serverId);
      onDeleted(serverId);
      onClose();
    } catch (err) {
      console.error('删除服务器失败:', err);
      setErrors({ form: '删除失败: ' + String(err) });
    }
  }, [serverId, name, onDeleted, onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑服务器' : '新建服务器'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {loading ? (
            <div className="text-center py-4 text-muted-foreground">加载中...</div>
          ) : (
            <>
              {errors.form && <div className="text-sm text-destructive">{errors.form}</div>}

              <div className="space-y-2">
                <Label htmlFor="name">名称</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="我的服务器"
                  className={errors.name ? 'border-destructive' : ''}
                />
                {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="host">主机地址</Label>
                <Input
                  id="host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="192.168.1.100 或 example.com"
                  className={errors.host ? 'border-destructive' : ''}
                />
                {errors.host && <p className="text-xs text-destructive">{errors.host}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="port">端口</Label>
                <Input
                  id="port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="22"
                  min={1}
                  max={65535}
                  className={errors.port ? 'border-destructive' : ''}
                />
                {errors.port && <p className="text-xs text-destructive">{errors.port}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="root"
                  className={errors.username ? 'border-destructive' : ''}
                />
                {errors.username && <p className="text-xs text-destructive">{errors.username}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="group">分组</Label>
                <select
                  id="group"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={groupId ?? ''}
                  onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">无分组</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id ?? ''}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label>认证方式</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={authType === 'password' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAuthType('password')}
                  >
                    密码
                  </Button>
                  <Button
                    type="button"
                    variant={authType === 'key' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAuthType('key')}
                  >
                    密钥
                  </Button>
                </div>
              </div>

              {authType === 'password' && (
                <div className="space-y-2">
                  <Label htmlFor="password">密码</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={hasExistingPassword ? '••••••（不填则保留原密码）' : '输入密码'}
                  />
                  <p className="text-xs text-muted-foreground">
                    {hasExistingPassword ? '留空将保留原有密码' : '输入服务器登录密码'}
                  </p>
                </div>
              )}

              {authType === 'key' && (
                <div className="space-y-2">
                  <Label htmlFor="keypath">私钥路径</Label>
                  <Input
                    id="keypath"
                    value={privateKeyPath}
                    onChange={(e) => setPrivateKeyPath(e.target.value)}
                    placeholder="/home/user/.ssh/id_rsa"
                  />
                  <p className="text-xs text-muted-foreground">输入 SSH 私钥的完整路径</p>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          {isEdit && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={saving || loading}
              className="mr-auto"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              删除
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ServerDialog;
