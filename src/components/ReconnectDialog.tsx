import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';

interface ReconnectDialogProps {
  open: boolean;
  serverName: string;
  onOpenNewTab: () => void;
  onReconnect: () => void;
  onCancel: () => void;
}

function ReconnectDialog({ open, serverName, onOpenNewTab, onReconnect, onCancel }: ReconnectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-[400px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>服务器已连接</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            「{serverName}」已有活跃连接，请选择操作：
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button className="w-full" onClick={onOpenNewTab}>
            打开新窗口
          </Button>
          <Button variant="outline" className="w-full" onClick={onReconnect}>
            断开并重新连接
          </Button>
          <Button variant="outline" className="w-full" onClick={onCancel}>
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ReconnectDialog;
