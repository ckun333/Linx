/** 服务器分组 */
export interface ServerGroup {
  id: number | null;
  name: string;
  sort_order: number;
}

/** 认证方式 */
export type AuthType = 'key' | 'password';

/** SSH 服务器配置 */
export interface Server {
  id: number | null;
  group_id: number | null;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: AuthType;
  private_key_path: string | null;
  password: string | null;
  sort_order: number;
}

/** 服务器实时状态 */
export interface ServerStatus {
  server_id: number;
  online: boolean;
  cpu_usage: number;
  memory_usage: number;
  memory_total: number;
  memory_used: number;
  network_rx: number;
  network_tx: number;
  disk_usage: number;
  last_checked: string;
}

/** 远程文件信息 */
export interface RemoteFileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number;
  permissions: number;
  modified: number;
}

/** 导入导出配置 */
export interface ConfigExport {
  version: string;
  groups: ServerGroup[];
  servers: Server[];
}
