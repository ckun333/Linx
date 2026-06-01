import { useState, useEffect, useCallback } from 'react';
import { createGroup, updateGroup, deleteGroup } from '../hooks/useTauri';

interface GroupDialogProps {
  open: boolean;
  groupId: number | null; // null = create, number = rename
  groupName?: string; // current name for rename mode
  onClose: () => void;
  onSaved: () => void;
  onDeleted: (id: number) => void;
}

/**
 * 分组创建/重命名/删除对话框
 */
function GroupDialog({ open, groupId, groupName, onClose, onSaved, onDeleted }: GroupDialogProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRename = groupId !== null;

  useEffect(() => {
    if (!open) return;
    setName(isRename && groupName ? groupName : '');
    setError(null);
  }, [open, isRename, groupName]);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('分组名称不能为空');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (isRename && groupId !== null) {
        await updateGroup(groupId, trimmed, 0);
      } else {
        await createGroup(trimmed);
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error('保存分组失败:', err);
      setError('保存失败: ' + String(err));
    } finally {
      setSaving(false);
    }
  }, [name, isRename, groupId, onSaved, onClose]);

  const handleDelete = useCallback(async () => {
    if (groupId === null) return;
    if (!window.confirm(`确定要删除分组「${name}」吗？分组内的服务器不会被删除。`)) return;

    try {
      await deleteGroup(groupId);
      onDeleted(groupId);
      onClose();
    } catch (err) {
      console.error('删除分组失败:', err);
      setError('删除失败: ' + String(err));
    }
  }, [groupId, name, onDeleted, onClose]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
  }, [handleSave]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
      <div className="modal">
        <div className="modal-header">
          <h3>{isRename ? '重命名分组' : '新建分组'}</h3>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

          <div className="form-group">
            <label className="form-label">分组名称</label>
            <input
              className="form-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="输入分组名称"
              autoFocus
            />
          </div>
        </div>

        <div className="modal-footer">
          {isRename && (
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={saving}
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
            disabled={saving}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default GroupDialog;
