import { X } from 'lucide-react';
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
    <div className="flex items-center border-b border-border bg-secondary">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`flex items-center gap-1 px-3 py-2 text-sm border-r border-border cursor-pointer hover:bg-accent/50 ${
            tab.id === activeTabId ? 'border-b-2 border-primary bg-background' : ''
          }`}
          onClick={() => onSelectTab(tab.id)}
        >
          <span className="truncate max-w-[120px]">{tab.serverName}</span>
          <button
            className="ml-1 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
            title="关闭标签页"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

export default TabBar;
