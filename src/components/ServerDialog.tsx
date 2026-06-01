import { useState, useEffect, useCallback } from 'react';
import { getServerForEdit, createServer, updateServer, deleteServer, getGroups } from '../hooks/useTauri';
import type { Server, ServerGroup, AuthType } from '../types';

interface ServerDialogProps {
  open: boolean;
  serverId: number | null; // null = create mode, number = edit mode
  onClose: () => void;
  onSaved: () => void; // callback after save
  onDeleted: (id: number) => void;
}

/**
 * 服务器创建/编辑对话框
 *
 * 当 serverId 为 null 时为新建模式，否则为编辑模式
 */
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

  // 加载分组列表和服务器数据
  useEffect(() => {
    if (!open) return;

    // 加载分组
    getGroups().then(setGroups).catch(() => {});

    if (serverId === null) {
      // 创建模式：重置表单
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

    // 编辑模式：加载数据
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

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
      <div className="modal">
        <div className="modal-header">
          <h3>{isEdit ? '编辑服务器' : '新建服务器'}</h3>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>加载中...</div>
          ) : (
            <>
              {errors.form && <div className="form-error" style={{ marginBottom: 16 }}>{errors.form}</div>}

              <div className="form-group">
                <label className="form-label">名称</label>
                <input
                  className={`form-input ${errors.name ? 'input-error' : ''}`}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="我的服务器"
                />
                {errors.name && <div className="form-error">{errors.name}</div>}
              </div>

              <div className="form-group">
                <label className="form-label">主机地址</label>
                <input
                  className={`form-input ${errors.host ? 'input-error' : ''}`}
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="192.168.1.100 或 example.com"
                />
                {errors.host && <div className="form-error">{errors.host}</div>}
              </div>

              <div className="form-group">
                <label className="form-label">端口</label>
                <input
                  className={`form-input ${errors.port ? 'input-error' : ''}`}
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="22"
                  min={1}
                  max={65535}
                />
                {errors.port && <div className="form-error">{errors.port}</div>}
              </div>

              <div className="form-group">
                <label className="form-label">用户名</label>
                <input
                  className={`form-input ${errors.username ? 'input-error' : ''}`}
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="root"
                />
                {errors.username && <div className="form-error">{errors.username}</div>}
              </div>

              <div className="form-group">
                <label className="form-label">分组</label>
                <select
                  className="form-input"
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

              <div className="form-group">
                <label className="form-label">认证方式</label>
                <div className="auth-type-toggle">
                  <button
                    className={`auth-type-btn ${authType === 'password' ? 'active' : ''}`}
                    onClick={() => setAuthType('password')}
                    type="button"
                  >
                    密码
                  </button>
                  <button
                    className={`auth-type-btn ${authType === 'key' ? 'active' : ''}`}
                    onClick={() => setAuthType('key')}
                    type="button"
                  >
                    密钥
                  </button>
                </div>
              </div>

              {authType === 'password' && (
                <div className="form-group">
                  <label className="form-label">密码</label>
                  <input
                    className="form-input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={hasExistingPassword ? '••••••（不填则保留原密码）' : '输入密码'}
                  />
                  <div className="form-hint">
                    {hasExistingPassword ? '留空将保留原有密码' : '输入服务器登录密码'}
                  </div>
                </div>
              )}

              {authType === 'key' && (
                <div className="form-group">
                  <label className="form-label">私钥路径</label>
                  <input
                    className="form-input"
                    type="text"
                    value={privateKeyPath}
                    onChange={(e) => setPrivateKeyPath(e.target.value)}
                    placeholder="/home/user/.ssh/id_rsa"
                  />
                  <div className="form-hint">输入 SSH 私钥的完整路径</div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          {isEdit && (
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={saving || loading}
              style={{ marginRight: 'auto' }}
            >
              删除
            </button>
          )}
          <button className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ServerDialog;
