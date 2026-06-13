import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XtermTerminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { startShell, writeSsh, resizeSsh, disconnectSsh, getServers } from '../hooks/useTauri';

import 'xterm/css/xterm.css';

interface TerminalProps {
  serverId: number;
  tabId: string;
  shouldAutoConnect?: boolean;
  isActive?: boolean;
  onConnected?: (tabId: string, serverId: number) => void;
  onDisconnected?: (tabId: string, serverId: number) => void;
}

/**
 * SSH 终端组件（交互式 PTY 模式）
 *
 * 基于 xterm.js + FitAddon + WebLinksAddon，通过 Tauri 后端 SSH 连接
 * 使用 start_shell / write_ssh / resize_ssh 实现双向 PTY 交互
 * 通过 terminal-output 事件接收后端输出
 */
function Terminal({ serverId, tabId, shouldAutoConnect, isActive, onConnected, onDisconnected }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const connectedRef = useRef(false);
  const connectingRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [serverName, setServerName] = useState<string>('');
  const inputBufferRef = useRef<string>('');
  const inputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getServers().then((servers) => {
      const server = servers.find((s) => s.id === serverId);
      setServerName(server?.name ?? `服务器 #${serverId}`);
    }).catch(() => {
      setServerName(`服务器 #${serverId}`);
    });
  }, [serverId]);

  // 初始化 xterm.js
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XtermTerminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'Consolas', 'Cascadia Code', 'DejaVu Sans Mono', 'Ubuntu Mono', 'Fira Code', 'JetBrains Mono', monospace",
      rows: 30,
      cols: 80,
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
        black: '#1d202f',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    fitAddonRef.current = fitAddon;

    term.open(terminalRef.current);

    setTimeout(() => {
      fitAddon.fit();
      if (isActive) term.focus();
    }, 50);

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    const termRef = xtermRef;
    const batchTimeout = 16;
    term.onData((data) => {
      inputBufferRef.current += data;
      if (inputTimerRef.current) {
        clearTimeout(inputTimerRef.current);
      }
      inputTimerRef.current = setTimeout(() => {
        const buffered = inputBufferRef.current;
        inputBufferRef.current = '';
        inputTimerRef.current = null;
        if (buffered.length > 0) {
          writeSsh(tabId, buffered).catch((err) => {
            termRef.current?.writeln(`\x1b[31m写入失败: ${err}\x1b[0m`);
          });
        }
      }, batchTimeout);
    });

    term.onResize(({ cols, rows }) => {
      if (connectedRef.current) {
        resizeSsh(tabId, cols, rows).catch((err) => {
          console.error('resize_ssh 失败:', err);
        });
      }
    });

    xtermRef.current = term;

    return () => {
      window.removeEventListener('resize', handleResize);
      if (inputTimerRef.current) {
        clearTimeout(inputTimerRef.current);
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [serverId, tabId]);

  // 当标签页变为活跃时，聚焦到终端
  useEffect(() => {
    if (isActive && xtermRef.current) {
      // 延迟聚焦，等待 CSS 切换完成
      setTimeout(() => {
        xtermRef.current?.focus();
      }, 50);
    }
  }, [isActive]);

  const handleConnect = useCallback(async () => {
    if (connectedRef.current || connectingRef.current) return;
    setConnecting(true);
    connectingRef.current = true;
    setConnectionError(null);
    const fitAddon = fitAddonRef.current;

    xtermRef.current?.writeln(`\x1b[32m正在连接到服务器...\x1b[0m`);
    try {
      const result = await startShell(tabId, serverId);
      xtermRef.current?.writeln(`\x1b[32m${result}\x1b[0m`);

      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      const unlisten = await listen('terminal-output', (event: { payload: { session_id: string; server_id: number; data: string } }) => {
        if (event.payload.session_id === tabId) {
          xtermRef.current?.write(event.payload.data);
        }
      });
      unlistenRef.current = unlisten;

      if (fitAddon) {
        fitAddon.fit();
        const cols = xtermRef.current?.cols ?? 80;
        const rows = xtermRef.current?.rows ?? 30;
        await resizeSsh(tabId, cols, rows);
      }

      setConnected(true);
      connectedRef.current = true;
      onConnected?.(tabId, serverId);
    } catch (err) {
      const msg = String(err);
      xtermRef.current?.writeln(`\x1b[31m连接失败: ${msg}\x1b[0m`);
      setConnectionError(msg);
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }, [serverId, tabId, onConnected]);

  // shouldAutoConnect 为 true 时自动连接
  useEffect(() => {
    if (shouldAutoConnect) {
      handleConnect();
    }
  }, [shouldAutoConnect, handleConnect]);

  const handleDisconnect = useCallback(async () => {
    const term = xtermRef.current;

    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    try {
      await disconnectSsh(tabId, serverId);
      term?.writeln(`\x1b[33m连接已断开\x1b[0m`);
      setConnected(false);
      connectedRef.current = false;
      onDisconnected?.(tabId, serverId);
    } catch (err) {
      term?.writeln(`\x1b[31m断开失败: ${err}\x1b[0m`);
    }
  }, [tabId, serverId, onDisconnected]);

  return (
    <div className="terminal-container">
      <div className="terminal-toolbar">
        <span className="terminal-title">{serverName || `服务器 #${serverId}`}</span>
        <div className="terminal-actions">
          {!connected ? (
            <button
              className="btn btn-primary"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? '连接中...' : '连接'}
            </button>
          ) : (
            <button className="btn btn-danger" onClick={handleDisconnect}>
              断开
            </button>
          )}
        </div>
      </div>

      <div className="terminal-wrapper" ref={terminalRef} />

      {connectionError && (
        <div className="terminal-error">
          {connectionError}
        </div>
      )}
    </div>
  );
}

export default Terminal;
