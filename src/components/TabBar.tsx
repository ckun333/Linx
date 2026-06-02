import type { TabData } from '../types';

interface TabBarProps {
  tabs: TabData[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: TabBarProps) {
  if (tabs.length === 0) return null;
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => onSelectTab(tab.id)}
        >
          <span className="tab-name">{tab.serverName}</span>
          <button
            className="tab-close"
            onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
            title="关闭标签页"
          >×</button>
        </div>
      ))}
    </div>
  );
}

export default TabBar;
