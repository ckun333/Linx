import { useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Terminal from './components/Terminal';
import MonitorPanel from './components/MonitorPanel';

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

  const handleSelectServer = useCallback((serverId: number) => {
    setActiveServerId(serverId);
  }, []);

  return (
    <div className="app-layout">
      {/* 左侧面板 */}
      <div className={`panel-left ${leftOpen ? 'open' : 'closed'}`}>
        <Sidebar
          activeServerId={activeServerId}
          onSelectServer={handleSelectServer}
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
          <Terminal serverId={activeServerId} />
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
        <MonitorPanel serverId={activeServerId} />
      </div>
    </div>
  );
}

export default App;
