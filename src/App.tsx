import { useState, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ServerDialog from './components/ServerDialog';
import GroupDialog from './components/GroupDialog';
import Terminal from './components/Terminal';
import MonitorPanel from './components/MonitorPanel';
import TabBar from './components/TabBar';
import { deleteGroup } from './hooks/useTauri';
import type { TabData } from './types';

type DialogType = 'closed' | 'addServer' | 'editServer' | 'addGroup' | 'renameGroup';

interface DialogState {
  type: DialogType;
  serverId?: number;
  groupId?: number;
  groupName?: string;
}

function App() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  // 多标签页管理
  const [tabs, setTabs] = useState<TabData[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [connectedTabIds, setConnectedTabIds] = useState<Set<string>>(new Set());
  const tabIdCounter = useRef(0);
  const [monitorRefreshKey, setMonitorRefreshKey] = useState(0);
  const [shouldAutoConnectTabId, setShouldAutoConnectTabId] = useState<string | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTab = tabs.find(t => t.id === activeTabId) ?? null;

  // 打开/切换到指定服务器的标签页
  const openTab = useCallback((serverId: number, serverName: string, autoConnect: boolean) => {
    const existing = tabsRef.current.find(t => t.serverId === serverId);
    if (existing) {
      setActiveTabId(existing.id);
      if (autoConnect) {
        setShouldAutoConnectTabId(existing.id);
        setMonitorRefreshKey(k => k + 1);
      }
      return;
    }
    const id = `tab-${++tabIdCounter.current}`;
    setTabs(prev => [...prev, { id, serverId, serverName }]);
    setActiveTabId(id);
    if (autoConnect) {
      setShouldAutoConnectTabId(id);
      setMonitorRefreshKey(k => k + 1);
    }
  }, []);

  const handleSelectServer = useCallback((serverId: number, serverName: string) => {
    openTab(serverId, serverName, false);
  }, [openTab]);

  const handleDoubleClickServer = useCallback((serverId: number, serverName: string) => {
    openTab(serverId, serverName, true);
  }, [openTab]);

  // 标签页操作
  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const handleCloseTab = useCallback((tabId: string) => {
    setTabs(prev => prev.filter(t => t.id !== tabId));
    setActiveTabId(prev => {
      if (prev !== tabId) return prev;
      const remaining = tabsRef.current.filter(t => t.id !== tabId);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
    setConnectedTabIds(prev => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
    setShouldAutoConnectTabId(prev => prev === tabId ? null : prev);
  }, []);

  const handleTerminalConnected = useCallback((serverId: number) => {
    const tab = tabsRef.current.find(t => t.serverId === serverId);
    if (tab) {
      setConnectedTabIds(prev => new Set(prev).add(tab.id));
      setShouldAutoConnectTabId(prev => prev === tab.id ? null : prev);
    }
  }, []);

  const handleTerminalDisconnected = useCallback((serverId: number) => {
    const tab = tabsRef.current.find(t => t.serverId === serverId);
    if (tab) {
      setConnectedTabIds(prev => {
        const next = new Set(prev);
        next.delete(tab.id);
        return next;
      });
    }
  }, []);

  // 对话框状态管理
  const [dialogState, setDialogState] = useState<DialogState>({ type: 'closed' });
  const [refreshKey, setRefreshKey] = useState(0);
  const handleRefreshServerList = useCallback(() => setRefreshKey((k) => k + 1), []);

  const openDialog = useCallback((state: DialogState) => {
    setDialogState(state);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogState({ type: 'closed' });
  }, []);

  const handleDeleted = useCallback(
    (id: number) => {
      handleRefreshServerList();
      // 关闭对应服务器标签页
      setTabs(prev => prev.filter(t => t.serverId !== id));
      setActiveTabId(() => {
        const remaining = tabsRef.current.filter(t => t.serverId !== id);
        return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      });
    },
    [handleRefreshServerList],
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
          activeServerId={activeTab?.serverId ?? null}
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

      {/* 中间主区域 */}
      <div className="panel-center">
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
        />
        {tabs.length === 0 ? (
          <div className="welcome-screen">
            <h1>Linx</h1>
            <p>从左侧选择一个服务器开始连接</p>
          </div>
        ) : (
          tabs.map((tab) => (
            <div
              key={tab.id}
              className={`terminal-pane ${tab.id === activeTabId ? 'active' : 'inactive'}`}
            >
              <Terminal
                serverId={tab.serverId}
                shouldAutoConnect={tab.id === shouldAutoConnectTabId}
                onConnected={handleTerminalConnected}
                onDisconnected={handleTerminalDisconnected}
              />
            </div>
          ))
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
        <MonitorPanel
          serverId={activeTab?.serverId ?? null}
          refreshKey={monitorRefreshKey}
          connectedServerId={activeTab && connectedTabIds.has(activeTab.id) ? activeTab.serverId : null}
        />
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
