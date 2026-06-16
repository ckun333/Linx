import { useState, useEffect, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { createGroup, updateGroup, deleteGroup } from '../hooks/useTauri';

interface GroupDialogProps {
  open: boolean;
  groupId: number | null;
  groupName?: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: (id: number) => void;
}

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

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
  }, [handleSave]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{isRename ? '重命名分组' : '新建分组'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-2">
            <Label htmlFor="group-name">分组名称</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="输入分组名称"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          {isRename && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={saving}
              className="mr-auto"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              删除
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GroupDialog;
