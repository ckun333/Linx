# Linx

小巧、便捷的 SSH 终端管理工具。快速管理服务器连接、查看节点状态。

## 功能

- 左侧：服务器列表（分组管理），支持在线/离线状态检测
- 中间：SSH 终端（xterm.js），多标签页支持
- 右侧：服务器监控面板（CPU/内存/网络/磁盘），实时刷新
- 配置导入/导出，支持 JSON 格式

## 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| **桌面框架** | Tauri v2 | 跨平台（Windows / Linux） |
| **前端** | React 18 + TypeScript | Vite 构建 |
| **UI** | shadcn/ui + Tailwind CSS | 暗色主题，Tokyo Night 配色 |
| **图标** | lucide-react | 统一图标库 |
| **终端** | xterm.js | FitAddon + WebLinksAddon |
| **SSH** | Rust ssh2 crate | 原生支持 SFTP 协议 |
| **监控** | SSH 采集 /proc 指标 | Linux 远程服务器监控 |
| **配置** | SQLite (rusqlite) | AES-GCM 加密存储密码 |

## 布局

```
┌──────────────┬─────────────────────┬─────────────┐
│  左侧 (可收起) │      主区域          │  右侧 (可收起) │
│              │                     │              │
│  服务器列表    │    终端 (xterm)     │  监控面板     │
│  ├ 分组A      │  多 Tab 支持        │  CPU/内存    │
│  │  ├ server │                     │  网络/磁盘   │
│  │  └ server │                     │              │
│  └ 分组B      │                     │              │
└──────────────┴─────────────────────┴─────────────┘
```

## 开发

```bash
# 安装依赖
npm install

# 前端开发（浏览器预览）
npm run dev

# 完整应用开发（Tauri 窗口）
npm run tauri dev

# 构建
npm run build          # 前端构建
npm run tauri build    # 生产构建（.deb / .msi）

# Rust 测试
cd src-tauri && cargo test
```

## 项目结构

```
src/                    # React 前端
  components/           # UI 组件
    ui/                 # shadcn/ui 组件（Button, Dialog, Input, Select 等）
    Sidebar.tsx         # 左侧面板
    Terminal.tsx        # SSH 终端
    MonitorPanel.tsx    # 监控面板
    ServerDialog.tsx    # 服务器编辑对话框
  hooks/useTauri.ts     # Tauri invoke 封装（浏览器环境返回 mock 数据）
  contexts/ToastContext.tsx
  types.ts
  App.tsx               # 三栏布局

src-tauri/src/          # Rust 后端
  commands.rs           # Tauri 命令处理
  db.rs                 # SQLite CRUD
  ssh.rs                # SSH 连接管理
  monitor.rs            # 远程服务器监控
  crypto.rs             # AES-GCM 加密
```

## 未来规划

- [ ] 分屏多终端
- [ ] SFTP 文件传输
- [ ] 监控指标可定制
- [ ] 服务器配置导入/导出
