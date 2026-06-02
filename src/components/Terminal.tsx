import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XtermTerminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { startShell, writeSsh, resizeSsh, disconnectSsh, getServers } from '../hooks/useTauri';

import 'xterm/css/xterm.css';

interface TerminalProps {
  serverId: number;
  shouldAutoConnect?: boolean;
  onConnected?: (serverId: number) => void;
  onDisconnected?: (serverId: number) => void;
}

/**
 * SSH 终端组件（交互式 PTY 模式）
 *
 * 基于 xterm.js + FitAddon + WebLinksAddon，通过 Tauri 后端 SSH 连接
 * 使用 start_shell / write_ssh / resize_ssh 实现双向 PTY 交互
 * 通过 terminal-output 事件接收后端输出
 */
function Terminal({ serverId, shouldAutoConnect, onConnected, onDisconnected }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const connectedRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [serverName, setServerName] = useState<string>('');

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

    setTimeout(() => fitAddon.fit(), 50);

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    const termRef = xtermRef;
    term.onData((data) => {
      writeSsh(serverId, data).catch((err) => {
        termRef.current?.writeln(`\x1b[31m写入失败: ${err}\x1b[0m`);
      });
    });

    term.onResize(({ cols, rows }) => {
      if (connectedRef.current) {
        resizeSsh(serverId, cols, rows).catch((err) => {
          console.error('resize_ssh 失败:', err);
        });
      }
    });

    xtermRef.current = term;

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [serverId]);

  const handleConnect = useCallback(async () => {
    if (connected || connecting) return;
    setConnecting(true);
    setConnectionError(null);
    const fitAddon = fitAddonRef.current;

    xtermRef.current?.writeln(`\x1b[32m正在连接到服务器...\x1b[0m`);
    try {
      const result = await startShell(serverId);
      xtermRef.current?.writeln(`\x1b[32m${result}\x1b[0m`);

      const unlisten = await listen('terminal-output', (event: { payload: { server_id: number; data: string } }) => {
        if (event.payload.server_id === serverId) {
          // 使用 xtermRef.current 确保写入当前的 xterm 实例
          xtermRef.current?.write(event.payload.data);
        }
      });
      unlistenRef.current = unlisten;

      if (fitAddon) {
        fitAddon.fit();
        const cols = xtermRef.current?.cols ?? 80;
        const rows = xtermRef.current?.rows ?? 30;
        await resizeSsh(serverId, cols, rows);
      }

      setConnected(true);
      connectedRef.current = true;
      onConnected?.(serverId);
    } catch (err) {
      const msg = String(err);
      xtermRef.current?.writeln(`\x1b[31m连接失败: ${msg}\x1b[0m`);
      setConnectionError(msg);
    } finally {
      setConnecting(false);
    }
  }, [serverId, onConnected]);

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
      await disconnectSsh(serverId);
      term?.writeln(`\x1b[33m连接已断开\x1b[0m`);
      setConnected(false);
      connectedRef.current = false;
      onDisconnected?.(serverId);
    } catch (err) {
      term?.writeln(`\x1b[31m断开失败: ${err}\x1b[0m`);
    }
  }, [serverId, onDisconnected]);

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
