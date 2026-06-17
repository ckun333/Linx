import { useState, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Terminal } from 'lucide-react';
import Sidebar from './components/Sidebar';
import ServerDialog from './components/ServerDialog';
import GroupDialog from './components/GroupDialog';
import TerminalPanel from './components/Terminal';
import MonitorPanel from './components/MonitorPanel';
import TabBar from './components/TabBar';
import ReconnectDialog from './components/ReconnectDialog';
import { deleteGroup, disconnectSsh } from './hooks/useTauri';
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

  const [tabs, setTabs] = useState<TabData[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [connectedTabIds, setConnectedTabIds] = useState<Set<string>>(new Set());
  const tabIdCounter = useRef(0);
  const [monitorRefreshKey, setMonitorRefreshKey] = useState(0);
  const [shouldAutoConnectTabId, setShouldAutoConnectTabId] = useState<string | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const connectedTabIdsRef = useRef(connectedTabIds);
  connectedTabIdsRef.current = connectedTabIds;
  const [reconnectTarget, setReconnectTarget] = useState<{
    serverId: number;
    serverName: string;
    existingTabId: string;
  } | null>(null);
  const [terminalKeys, setTerminalKeys] = useState<Record<string, number>>({});

  const activeTab = tabs.find(t => t.id === activeTabId) ?? null;

  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openTab = useCallback((serverId: number, serverName: string, autoConnect: boolean, forceNew?: boolean) => {
    const existing = tabsRef.current.find(t => t.serverId === serverId);
    if (existing && !forceNew) {
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
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      openTab(serverId, serverName, false);
    }, 200);
  }, [openTab]);

  const handleDoubleClickServer = useCallback((serverId: number, serverName: string) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    const at = tabsRef.current.find(t => t.id === activeTabId);
    if (at && at.serverId === serverId && connectedTabIdsRef.current.has(at.id)) {
      setReconnectTarget({ serverId, serverName, existingTabId: at.id });
      return;
    }
    const existing = tabsRef.current.find(t => t.serverId === serverId && connectedTabIdsRef.current.has(t.id));
    if (existing) {
      setReconnectTarget({ serverId, serverName, existingTabId: existing.id });
      return;
    }
    openTab(serverId, serverName, true);
  }, [openTab, activeTabId]);

  const handleOpenNewTab = useCallback(() => {
    if (!reconnectTarget) return;
    openTab(reconnectTarget.serverId, reconnectTarget.serverName, true, true);
    setReconnectTarget(null);
  }, [reconnectTarget, openTab]);

  const handleReconnect = useCallback(async () => {
    if (!reconnectTarget) return;
    const { serverId, existingTabId } = reconnectTarget;
    setReconnectTarget(null);

    try {
      await disconnectSsh(existingTabId, serverId);
    } catch (err) {
      console.error('断开连接失败:', err);
    }

    setConnectedTabIds(prev => {
      const next = new Set(prev);
      next.delete(existingTabId);
      return next;
    });
    setShouldAutoConnectTabId(null);

    setTerminalKeys(prev => ({
      ...prev,
      [existingTabId]: (prev[existingTabId] || 0) + 1,
    }));

    setActiveTabId(existingTabId);
    setTimeout(() => {
      setShouldAutoConnectTabId(existingTabId);
    }, 0);
  }, [reconnectTarget]);

  const handleCancelReconnect = useCallback(() => {
    if (!reconnectTarget) return;
    setActiveTabId(reconnectTarget.existingTabId);
    setShouldAutoConnectTabId(null);
    setReconnectTarget(null);
  }, [reconnectTarget]);

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
    setTerminalKeys(prev => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    if (reconnectTarget?.existingTabId === tabId) {
      setReconnectTarget(null);
    }
  }, [reconnectTarget]);

  const handleTerminalConnected = useCallback((tabId: string, _serverId: number) => {
    setConnectedTabIds(prev => new Set(prev).add(tabId));
    setShouldAutoConnectTabId(prev => prev === tabId ? null : prev);
  }, []);

  const handleTerminalDisconnected = useCallback((tabId: string, _serverId: number) => {
    setConnectedTabIds(prev => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

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
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Left Panel */}
      <div
        className={`shrink-0 border-r border-border bg-card overflow-hidden transition-all duration-200 ${
          leftOpen ? 'w-64' : 'w-0'
        }`}
      >
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

      {/* Left Toggle */}
      <button
        className="w-5 shrink-0 flex items-center justify-center bg-secondary hover:bg-accent transition-colors cursor-pointer"
        onClick={() => setLeftOpen((v) => !v)}
        title={leftOpen ? '收起左侧' : '展开左侧'}
      >
        {leftOpen ? <ChevronLeft className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>

      {/* Center Panel */}
      <div className="flex-1 flex flex-col min-w-0">
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
        />
        {tabs.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Terminal className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg">从左侧选择一个服务器开始连接</p>
            </div>
          </div>
        ) : (
          tabs.map((tab) => {
            const termKey = `${tab.id}-v${terminalKeys[tab.id] ?? 0}`;
            return (
              <div
                key={tab.id}
                className={`flex-1 ${tab.id === activeTabId ? 'block' : 'hidden'}`}
              >
                <TerminalPanel
                  key={termKey}
                  tabId={tab.id}
                  serverId={tab.serverId}
                  shouldAutoConnect={tab.id === shouldAutoConnectTabId}
                  isActive={tab.id === activeTabId}
                  onConnected={handleTerminalConnected}
                  onDisconnected={handleTerminalDisconnected}
                />
              </div>
            );
          })
        )}
      </div>

      {/* Right Toggle */}
      <button
        className="w-5 shrink-0 flex items-center justify-center bg-secondary hover:bg-accent transition-colors cursor-pointer"
        onClick={() => setRightOpen((v) => !v)}
        title={rightOpen ? '收起右侧' : '展开右侧'}
      >
        {rightOpen ? <ChevronRight className="w-4 h-4 text-muted-foreground" /> : <ChevronLeft className="w-4 h-4 text-muted-foreground" />}
      </button>

      {/* Right Panel */}
      <div
        className={`shrink-0 border-l border-border bg-card overflow-hidden transition-all duration-200 ${
          rightOpen ? 'w-72' : 'w-0'
        }`}
      >
        <MonitorPanel
          serverId={activeTab?.serverId ?? null}
          refreshKey={monitorRefreshKey}
          connectedServerId={activeTab && connectedTabIds.has(activeTab.id) ? activeTab.serverId : null}
        />
      </div>

      {/* Dialogs */}
      <ServerDialog
        open={dialogState.type === 'addServer' || dialogState.type === 'editServer'}
        serverId={dialogState.type === 'editServer' ? dialogState.serverId! : null}
        onClose={closeDialog}
        onSaved={handleRefreshServerList}
        onDeleted={handleDeleted}
      />

      <GroupDialog
        open={dialogState.type === 'addGroup' || dialogState.type === 'renameGroup'}
        groupId={dialogState.type === 'renameGroup' ? dialogState.groupId! : null}
        groupName={dialogState.type === 'renameGroup' ? dialogState.groupName : undefined}
        onClose={closeDialog}
        onSaved={handleRefreshServerList}
        onDeleted={handleRefreshServerList}
      />

      <ReconnectDialog
        open={reconnectTarget !== null}
        serverName={reconnectTarget?.serverName ?? ''}
        onOpenNewTab={handleOpenNewTab}
        onReconnect={handleReconnect}
        onCancel={handleCancelReconnect}
      />
    </div>
  );
}

export default App;
