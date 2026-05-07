/**
 * Tauri invoke 封装
 *
 * 封装 @tauri-apps/api 的 invoke 方法，提供类型安全的调用方式。
 * 在 Web 开发环境下（非 Tauri）提供 mock 支持。
 */

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

  const { invoke: tauriInvoke } = await import('@tauri-apps/api/tauri');
  return tauriInvoke<T>(cmd, args);
}

/**
 * 开发环境下的 mock 数据
 */
function getMockData<T>(_cmd: string, _args?: Record<string, unknown>): T {
  // 返回类型安全的默认值
  // 在真正的 Tauri 环境下这些不会被调用
  return {} as T;
}

// ==================== 分组 API ====================

export async function getGroups() {
  return invoke<import('../types').ServerGroup[]>('get_groups');
}

export async function createGroup(name: string, sortOrder = 0) {
  return invoke<import('../types').ServerGroup>('create_group', { name, sortOrder });
}

export async function updateGroup(id: number, name: string, sortOrder: number) {
  return invoke<void>('update_group', { id, name, sortOrder });
}

export async function deleteGroup(id: number) {
  return invoke<void>('delete_group', { id });
}

// ==================== 服务器 API ====================

export async function getServers() {
  return invoke<import('../types').Server[]>('get_servers');
}

export async function createServer(server: {
  groupId?: number | null;
  name: string;
  host: string;
  port?: number;
  username: string;
  authType: import('../types').AuthType;
  privateKeyPath?: string | null;
  password?: string | null;
  sortOrder?: number;
}) {
  return invoke<import('../types').Server>('create_server', {
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
  authType: import('../types').AuthType;
  privateKeyPath?: string | null;
  password?: string | null;
  sortOrder?: number;
}) {
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

export async function deleteServer(id: number) {
  return invoke<void>('delete_server', { id });
}

// ==================== SSH API ====================

export async function connectSsh(serverId: number) {
  return invoke<string>('connect_ssh', { serverId });
}

export async function disconnectSsh(serverId: number) {
  return invoke<string>('disconnect_ssh', { serverId });
}

export async function execSsh(serverId: number, command: string) {
  return invoke<string>('exec_ssh', { serverId, command });
}

// ==================== SFTP API ====================

export async function listDir(serverId: number, path: string) {
  return invoke<import('../types').RemoteFileInfo[]>('list_dir', { serverId, path });
}

// ==================== 监控 API ====================

export async function getServerStatus(serverId: number) {
  return invoke<import('../types').ServerStatus>('get_server_status', { serverId });
}

// ==================== 配置 API ====================

export async function exportConfig() {
  return invoke<import('../types').ConfigExport>('export_config');
}

export async function importConfig(config: import('../types').ConfigExport) {
  return invoke<void>('import_config', { config });
}
