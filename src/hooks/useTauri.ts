/**
 * Tauri invoke 封装
 *
 * 封装 @tauri-apps/api 的 invoke 方法，提供类型安全的调用方式。
 * 在 Web 开发环境下（非 Tauri）提供 mock 支持。
 */

import type { ServerGroup, Server, AuthType, ConfigExport, ServerStatus, RemoteFileInfo } from '../types';

// 判断是否在 Tauri 环境中
const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

/**
 * 调用 Tauri 后端命令
 * 如果在浏览器中运行（非 Tauri），返回默认值
 */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    console.warn(`[Linx] 非 Tauri 环境，命令 "${cmd}" 返回空值`);
    return getMockData<T>(cmd, args);
  }

  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

/**
 * 开发环境下的 mock 数据
 */
function getMockData<T>(_cmd: string, _args?: Record<string, unknown>): T {
  return {} as T;
}

// ==================== 分组 API ====================

export async function getGroups(): Promise<ServerGroup[]> {
  return invoke<ServerGroup[]>('get_groups');
}

export async function createGroup(name: string, sortOrder = 0): Promise<ServerGroup> {
  return invoke<ServerGroup>('create_group', { name, sortOrder });
}

export async function updateGroup(id: number, name: string, sortOrder: number): Promise<void> {
  return invoke<void>('update_group', { id, name, sortOrder });
}

export async function deleteGroup(id: number): Promise<void> {
  return invoke<void>('delete_group', { id });
}

// ==================== 服务器 API ====================

export async function getServers(): Promise<Server[]> {
  return invoke<Server[]>('get_servers');
}

/** 获取服务器信息（含解密密码，仅用于编辑） */
export async function getServerForEdit(id: number): Promise<Server> {
  return invoke<Server>('get_server_for_edit', { id });
}

/** 检查服务器连通性 */
export async function checkServerConnectivity(host: string, port: number): Promise<boolean> {
  return invoke<boolean>('check_server_connectivity', { host, port });
}

export async function createServer(server: {
  groupId?: number | null;
  name: string;
  host: string;
  port?: number;
  username: string;
  authType: AuthType;
  privateKeyPath?: string | null;
  password?: string | null;
  sortOrder?: number;
}): Promise<Server> {
  return invoke<Server>('create_server', {
    groupId: server.groupId ?? null,
    name: server.name,
    host: server.host,
    port: server.port ?? 22,
    username: server.username,
    authType: server.authType,
    privateKeyPath: server.privateKeyPath ?? null,
    password: server.password ?? null,
    sortOrder: server.sortOrder ?? 0,
  });
}

export async function updateServer(server: {
  id: number;
  groupId?: number | null;
  name: string;
  host: string;
  port?: number;
  username: string;
  authType: AuthType;
  privateKeyPath?: string | null;
  password?: string | null;
  sortOrder?: number;
}): Promise<void> {
  return invoke<void>('update_server', {
    id: server.id,
    groupId: server.groupId ?? null,
    name: server.name,
    host: server.host,
    port: server.port ?? 22,
    username: server.username,
    authType: server.authType,
    privateKeyPath: server.privateKeyPath ?? null,
    password: server.password ?? null,
    sortOrder: server.sortOrder ?? 0,
  });
}

export async function deleteServer(id: number): Promise<void> {
  return invoke<void>('delete_server', { id });
}

// ==================== SSH API ====================

export async function connectSsh(serverId: number): Promise<string> {
  return invoke<string>('connect_ssh', { serverId });
}

export async function disconnectSsh(serverId: number): Promise<string> {
  return invoke<string>('disconnect_ssh', { serverId });
}

export async function execSsh(serverId: number, command: string): Promise<string> {
  return invoke<string>('exec_ssh', { serverId, command });
}

export async function startShell(serverId: number): Promise<string> {
  return invoke<string>('start_shell', { serverId });
}

export async function writeSsh(serverId: number, data: string): Promise<void> {
  return invoke<void>('write_ssh', { serverId, data });
}

export async function resizeSsh(serverId: number, cols: number, rows: number): Promise<void> {
  return invoke<void>('resize_ssh', { serverId, cols, rows });
}

// ==================== SFTP API ====================

export async function listDir(serverId: number, path: string): Promise<RemoteFileInfo[]> {
  return invoke<RemoteFileInfo[]>('list_dir', { serverId, path });
}

// ==================== 监控 API ====================

export async function getServerStatus(serverId: number): Promise<ServerStatus> {
  return invoke<ServerStatus>('get_server_status', { serverId });
}

// ==================== 配置 API ====================

export async function exportConfig(): Promise<ConfigExport> {
  return invoke<ConfigExport>('export_config');
}

export async function importConfig(config: ConfigExport): Promise<void> {
  return invoke<void>('import_config', { config });
}

// ==================== 导入/导出 ====================

/** 导出配置到文件（打开保存对话框） */
export async function exportConfigToFile(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const selected = await save({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      defaultPath: 'linx-config.json',
    });
    if (!selected) return false;

    await invoke<void>('export_config_to_file', { path: selected });
    return true;
  } catch (e) {
    console.error('导出失败:', e);
    return false;
  }
}

/** 从文件导入配置（打开选择对话框） */
export async function importConfigFromFile(): Promise<{
  config: ConfigExport | null;
  serversWithoutPassword: Array<{ id: number | null; name: string; host: string }>;
}> {
  if (!isTauri) return { config: null, serversWithoutPassword: [] };
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!selected) return { config: null, serversWithoutPassword: [] };

    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return { config: null, serversWithoutPassword: [] };

    const config = await invoke<ConfigExport>('import_config_from_file', { path });

    // 检查没有密码的服务器
    const serversWithoutPassword = config.servers
      .filter(s => s.auth_type === 'password' && !s.password)
      .map(s => ({ id: s.id, name: s.name, host: s.host }));

    return { config, serversWithoutPassword };
  } catch (e) {
    console.error('导入失败:', e);
    return { config: null, serversWithoutPassword: [] };
  }
}

/** 确认导入（处理密码后） */
export async function confirmImportConfig(config: ConfigExport): Promise<void> {
  return invoke<void>('confirm_import_config', { config });
}
