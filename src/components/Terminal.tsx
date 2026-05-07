import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XtermTerminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { connectSsh, disconnectSsh, execSsh } from '../hooks/useTauri';

import 'xterm/css/xterm.css';

interface TerminalProps {
  serverId: number;
}

/**
 * SSH 终端组件
 *
 * 基于 xterm.js + FitAddon + WebLinksAddon，通过 Tauri 后端 SSH 连接
 * 支持:
 * - 连接到远程服务器
 * - 执行命令并显示输出
 * - 自适应容器大小
 */
function Terminal({ serverId }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // 初始化 xterm.js
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XtermTerminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
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

    // 安装插件
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    fitAddonRef.current = fitAddon;

    // 挂载到 DOM
    term.open(terminalRef.current);

    // 延迟自适应（等待 DOM 渲染完成）
    setTimeout(() => fitAddon.fit(), 50);

    // 监听窗口大小变化
    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    // 监听输入
    term.onData((data) => {
      // Phase 1: 简单命令执行模式
      // Phase 2: 将改为真正的 PTY 交互
      term.write(data);
    });

    xtermRef.current = term;

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // 连接 SSH
  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setConnectionError(null);
    const term = xtermRef.current;

    try {
      term?.writeln(`\x1b[32m正在连接到服务器...\x1b[0m`);
      const result = await connectSsh(serverId);
      term?.writeln(`\x1b[32m${result}\x1b[0m`);
      setConnected(true);

      // 发送一个测试命令验证连接
      try {
        const uname = await execSsh(serverId, 'uname -a');
        term?.writeln(`\x1b[36m${uname}\x1b[0m`);
        term?.writeln(`\x1b[32m连接成功！\x1b[0m`);
      } catch {
        // 即使命令失败，连接本身是成功的
      }
    } catch (err) {
      const msg = String(err);
      term?.writeln(`\x1b[31m连接失败: ${msg}\x1b[0m`);
      setConnectionError(msg);
    } finally {
      setConnecting(false);
    }
  }, [serverId]);

  // 断开连接
  const handleDisconnect = useCallback(async () => {
    const term = xtermRef.current;
    try {
      await disconnectSsh(serverId);
      term?.writeln(`\x1b[33m连接已断开\x1b[0m`);
      setConnected(false);
    } catch (err) {
      term?.writeln(`\x1b[31m断开失败: ${err}\x1b[0m`);
    }
  }, [serverId]);

  return (
    <div className="terminal-container">
      {/* 工具栏 */}
      <div className="terminal-toolbar">
        <span className="terminal-title">终端 - 服务器 #{serverId}</span>
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

      {/* xterm 终端 */}
      <div className="terminal-wrapper" ref={terminalRef} />

      {/* 错误信息 */}
      {connectionError && (
        <div className="terminal-error">
          {connectionError}
        </div>
      )}
    </div>
  );
}

export default Terminal;
