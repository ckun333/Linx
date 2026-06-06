# Linx - Agent Knowledge Base

Tauri v2 desktop app for SSH terminal management. React + TypeScript frontend, Rust backend, SQLite storage.

## Commands

```bash
# Development
npm run tauri dev          # Full app dev mode (Vite + Tauri window)
npm run dev                # Frontend only (Vite on port 1420)

# Build
npm run build              # tsc + vite build (frontend only)
npm run tauri build        # Full production build (.deb / .msi)

# Rust backend
cd src-tauri && cargo test # Run all Rust unit tests (15 tests)
```

## Architecture

```
src/                    # React frontend (TypeScript)
  components/           # UI components (Sidebar, Terminal, MonitorPanel, etc.)
  hooks/useTauri.ts     # Type-safe Tauri invoke wrapper
  contexts/             # React contexts (Toast)
  types.ts              # Shared TypeScript interfaces
  App.tsx               # Main layout (3-column: sidebar | terminal | monitor)

src-tauri/src/          # Rust backend
  lib.rs                # App entry, state init, Tauri builder
  commands.rs           # All Tauri command handlers (~458 lines)
  db.rs                 # SQLite CRUD via rusqlite (~818 lines)
  ssh.rs                # SSH connection management (ssh2 crate)
  monitor.rs            # System monitoring via /proc
  crypto.rs             # AES-GCM encryption for stored passwords
  models.rs             # Shared data structures (Server, ServerGroup, etc.)
```

## Key Patterns

### Frontend → Backend Communication
All backend calls go through `src/hooks/useTauri.ts`. This wrapper:
- Provides type-safe `invoke<T>()` function
- Returns mock data when running outside Tauri (browser dev)
- Handles dialog plugins (`@tauri-apps/plugin-dialog`)

### Database
- **Dev**: `linx_dev.db` in project root (gitignored)
- **Prod**: `~/.linx/linx.db`
- WAL mode enabled, foreign keys on
- Passwords encrypted with AES-GCM before storage
- Schema auto-migrates on startup (`db.rs::migrate()`)

### State Management
- `AppState` in `commands.rs` holds all Mutex-wrapped state
- DB connection, SSH shells, connections, credentials, monitor connections
- All accessed via Tauri `State<'_, AppState>` in command handlers

## Conventions

### TypeScript (src/)
- **Strict mode**: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- **No lint/format tooling**: No ESLint, Prettier, or Biome configured
- **JSX**: `react-jsx` transform (no React import needed)
- **Module**: ESNext, bundler resolution, `"type": "module"`

### Rust (src-tauri/)
- Edition 2021, default rustfmt/clippy settings
- Errors mapped to `String` via `.map_err(|e| e.to_string())` for Tauri commands
- Tauri commands use `rename_all = "camelCase"` for JS-friendly names

### UI
- CSS variables for theming (Tokyo Night palette)
- Dark theme hardcoded (no light mode)
- Three-column collapsible layout: sidebar | terminal | monitor

## Testing

**Rust only** — no frontend tests exist.

```bash
cd src-tauri && cargo test
```

Tests use in-memory SQLite, run fast, no side effects.

## CI/CD

`.github/workflows/build.yml` — triggered on `v*` tags:
- Builds on Ubuntu + Windows
- Produces `.deb` (Linux) and `.msi` (Windows)
- Creates GitHub Release with artifacts
- **Note**: No `cargo test` step in CI

## Gotchas

1. **Vite port fixed at 1420** — required by Tauri, `strictPort: true`
2. **`src-tauri/` ignored by Vite watcher** — prevents restart loops
3. **CSP disabled** (`"csp": null`) — no Content Security Policy
4. **Linux build deps**: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev`
5. **No test framework** — if adding frontend tests, use Vitest (recommended for Vite)
6. **Dev database location** — `linx_dev.db` is created at project root, not in `src-tauri/`
