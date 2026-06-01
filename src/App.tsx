import { useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ServerDialog from './components/ServerDialog';
import GroupDialog from './components/GroupDialog';
import Terminal from './components/Terminal';
import MonitorPanel from './components/MonitorPanel';
import { deleteGroup } from './hooks/useTauri';

type DialogType = 'closed' | 'addServer' | 'editServer' | 'addGroup' | 'renameGroup';

interface DialogState {
  type: DialogType;
  serverId?: number;
  groupId?: number;
  groupName?: string;
}

/**
 * 主应用组件 - 三栏布局
 *
 * 布局结构:
 * ┌──────────────┬─────────────────────┬─────────────┐
 * │  左侧 (收起)  │      主区域          │  右侧 (收起)  │
 * │  服务器列表    │    终端 (xterm)     │  监控面板     │
 * │  + SFTP      │                     │              │
 * └──────────────┴─────────────────────┴─────────────┘
 */
function App() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  // 当前选中的服务器 ID
  const [activeServerId, setActiveServerId] = useState<number | null>(null);
  // 双击触发自增计数器，每次双击+1，Terminal 检测变化后重新连接
  const [autoConnectTick, setAutoConnectTick] = useState(0);

  // 对话框状态管理
  const [dialogState, setDialogState] = useState<DialogState>({ type: 'closed' });

  // 刷新 key，用于触发 Sidebar 重新加载数据
  const [refreshKey, setRefreshKey] = useState(0);
  const handleRefreshServerList = useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleSelectServer = useCallback((serverId: number) => {
    setActiveServerId(serverId);
  }, []);

  const handleDoubleClickServer = useCallback((serverId: number) => {
    setActiveServerId(serverId);
    setAutoConnectTick(t => t + 1);
  }, []);

  // 对话框控制
  const openDialog = useCallback((state: DialogState) => {
    setDialogState(state);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogState({ type: 'closed' });
  }, []);

  const handleDeleted = useCallback(
    (id: number) => {
      handleRefreshServerList();
      if (id === activeServerId) {
        setActiveServerId(null);
      }
    },
    [handleRefreshServerList, activeServerId],
  );

  const handleEditServer = useCallback((id: number) => {
    setDialogState({ type: 'editServer', serverId: id });
  }, []);

  const handleRenameGroup = useCallback((id: number, name: string) => {
    setDialogState({ type: 'renameGroup', groupId: id, groupName: name });
  }, []);

  const handleDeleteGroup = useCallback(
    async (id: number) => {
      if (!window.confirm('确定要删除此分组吗？分组内的服务器不会被删除。')) return;
      try {
        await deleteGroup(id);
        handleRefreshServerList();
      } catch (err) {
        console.error('删除分组失败:', err);
      }
    },
    [handleRefreshServerList],
  );

  return (
    <div className="app-layout">
      {/* 左侧面板 */}
      <div className={`panel-left ${leftOpen ? 'open' : 'closed'}`}>
        <Sidebar
          activeServerId={activeServerId}
          onSelectServer={handleSelectServer}
          onDoubleClickServer={handleDoubleClickServer}
          refreshKey={refreshKey}
          onAddServer={() => openDialog({ type: 'addServer' })}
          onEditServer={handleEditServer}
          onAddGroup={() => openDialog({ type: 'addGroup' })}
          onRenameGroup={handleRenameGroup}
          onDeleteGroup={handleDeleteGroup}
        />
      </div>

      {/* 左侧折叠按钮 */}
      <button
        className="toggle-btn toggle-left"
        onClick={() => setLeftOpen((v) => !v)}
        title={leftOpen ? '收起左侧' : '展开左侧'}
      >
        {leftOpen ? '◀' : '▶'}
      </button>

      {/* 中间主区域 - 终端 */}
      <div className="panel-center">
        {activeServerId ? (
          <Terminal serverId={activeServerId} autoConnectTick={autoConnectTick} />
        ) : (
          <div className="welcome-screen">
            <h1>Linx</h1>
            <p>从左侧选择一个服务器开始连接</p>
          </div>
        )}
      </div>

      {/* 右侧折叠按钮 */}
      <button
        className="toggle-btn toggle-right"
        onClick={() => setRightOpen((v) => !v)}
        title={rightOpen ? '收起右侧' : '展开右侧'}
      >
        {rightOpen ? '▶' : '◀'}
      </button>

      {/* 右侧面板 */}
      <div className={`panel-right ${rightOpen ? 'open' : 'closed'}`}>
        <MonitorPanel serverId={activeServerId} refreshKey={autoConnectTick} />
      </div>

      {/* 服务器编辑对话框 */}
      <ServerDialog
        open={dialogState.type === 'addServer' || dialogState.type === 'editServer'}
        serverId={dialogState.type === 'editServer' ? dialogState.serverId! : null}
        onClose={closeDialog}
        onSaved={handleRefreshServerList}
        onDeleted={handleDeleted}
      />

      {/* 分组编辑对话框 */}
      <GroupDialog
        open={dialogState.type === 'addGroup' || dialogState.type === 'renameGroup'}
        groupId={dialogState.type === 'renameGroup' ? dialogState.groupId! : null}
        groupName={dialogState.type === 'renameGroup' ? dialogState.groupName : undefined}
        onClose={closeDialog}
        onSaved={handleRefreshServerList}
        onDeleted={handleRefreshServerList}
      />
    </div>
  );
}

export default App;
