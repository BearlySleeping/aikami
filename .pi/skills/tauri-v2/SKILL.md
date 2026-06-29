---
name: tauri-v2
description: Tauri v2 desktop app patterns — SvelteKit integration, @tauri-apps/api modules, IPC invoke, window management, filesystem, shell commands, CSP configuration, and cross-platform build targets.
version: 1.0.0
tags: ["tauri", "desktop", "rust", "sveltekit", "ipc"]
---

# Tauri v2 — Desktop Patterns

Tauri v2 wraps the SvelteKit Client (PWA) inside a native Rust-powered webview for cross-platform desktop exports. The Rust backend lives in `src-tauri/` at the SvelteKit project root; the JS bridge is `@tauri-apps/api` v2.

---

## 1. Project Structure

```
apps/frontend/client/
├── src-tauri/
│   ├── Cargo.toml          # Rust dependencies (tauri, serde, etc.)
│   ├── src/
│   │   └── main.rs         # Tauri entry: builder + plugin registration + run
│   ├── tauri.conf.json     # Window, bundle, CSP, dev/build URLs
│   ├── capabilities/       # Tauri v2 capability permissions
│   │   └── default.json    # Default permissions for core plugins
│   └── icons/              # App icons for all platforms
└── package.json            # @tauri-apps/cli (devDep), @tauri-apps/api (dep)
```

Key constraint: `src-tauri/` lives at the SvelteKit project root, NOT inside `src/`.

---

## 2. tauri.conf.json

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-cli/schema.json",
  "productName": "Aikami",
  "version": "0.1.0",
  "identifier": "com.aikami.app",
  "build": {
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "bun run build",
    "frontendDist": "../build"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "Aikami",
        "width": 1200,
        "height": 800,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.aikami.app"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

---

## 3. Cargo.toml (minimal)

```toml
[package]
name = "aikami"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

Plugins are added both as Cargo dependencies AND as capabilities in `capabilities/default.json`.

---

## 4. main.rs (minimal)

```rust
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## 5. @tauri-apps/api v2 Modules

### 5.1 invoke — IPC to Rust backend

```ts
import { invoke } from '@tauri-apps/api/core';

// Call a Rust command registered with #[tauri::command]
const result = await invoke<string>('my_command', { arg: 'value' });
```

**Defining Rust commands**:
```rust
#[tauri::command]
fn my_command(arg: String) -> Result<String, String> {
    Ok(format!("received: {}", arg))
}

// Register in builder:
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![my_command])
```

### 5.2 window — Window management

```ts
import { getCurrentWindow } from '@tauri-apps/api/window';

const win = getCurrentWindow();

// Title
await win.setTitle('New Title');
const title = await win.title();

// Size/position
await win.setSize(new PhysicalSize(800, 600));
await win.setPosition(new PhysicalPosition(100, 100));
const maximized = await win.isMaximized();

// Events
win.onCloseRequested(async (event) => {
  // Prevent close, show save dialog, then destroy
  await win.destroy();
});

// Multiple windows
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
const webview = new WebviewWindow('settings', {
  url: '/settings',
  title: 'Settings',
  width: 600,
  height: 400,
});
```

### 5.3 fs — Filesystem access

```ts
import { readTextFile, writeTextFile, exists, createDir } from '@tauri-apps/plugin-fs';
// Note: requires tauri-plugin-fs in capabilities

const content = await readTextFile('/path/to/file.txt');
await writeTextFile('/path/to/file.txt', 'new content');
const fileExists = await exists('/path/to/file.txt');
await createDir('/path/to/dir', { recursive: true });
```

### 5.4 dialog — Native dialogs

```ts
import { open, save, message, ask } from '@tauri-apps/plugin-dialog';

const file = await open({
  filters: [{ name: 'Markdown', extensions: ['md'] }],
  multiple: false,
});

const confirmed = await ask('Are you sure?', {
  title: 'Confirm',
  kind: 'warning',
});

await message('Operation complete', { title: 'Success' });
```

### 5.5 shell — External commands

```ts
import { Command } from '@tauri-apps/plugin-shell';

const cmd = Command.create('echo', ['hello', 'world']);
const output = await cmd.execute();
console.log(output.stdout);
```

---

## 6. Capabilities (Tauri v2 Permissions)

Tauri v2 uses a capability-based permission system. Permissions are declared in `src-tauri/capabilities/default.json`:

```jsonc
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capabilities for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    // Only add what you need:
    "fs:default",
    "dialog:default",
    "shell:default"
  ]
}
```

Each plugin (fs, dialog, shell) requires explicit permission in capabilities AND the Cargo dependency.

---

## 7. package.json Scripts

```jsonc
{
  "scripts": {
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2"
  },
  "dependencies": {
    "@tauri-apps/api": "^2"
  }
}
```

- `@tauri-apps/cli` = devDependency (build-time CLI)
- `@tauri-apps/api` = dependency (runtime JS bridge)

---

## 8. SvelteKit Integration

### 8.1 Adapter

Tauri serves the frontend from local files. Use `@sveltejs/adapter-static`:

```ts
// svelte.config.js
import adapter from '@sveltejs/adapter-static';

export default {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
    }),
  },
};
```

### 8.2 SSR consideration

Tauri's webview loads `index.html` — SSR (adapter-node) is unnecessary and may break. Always use `adapter-static` for Tauri.

### 8.3 Environment detection

```ts
// Detect if running in Tauri (not browser)
import { isTauri } from '@tauri-apps/api/core';
// v2 note: isTauri() is synchronous
if (isTauri()) {
  // Desktop-specific code
}
```

---

## 9. Gotchas

### 9.1 CSP Restrictions
Tauri's webview enforces CSP. External API calls, WebSocket connections, and inline scripts/styles must be allowlisted in `tauri.conf.json` → `app.security.csp`. Example for Firebase:
```json
"csp": "default-src 'self'; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com; style-src 'self' 'unsafe-inline'; script-src 'self'"
```

### 9.2 Tauri v2 vs v1 Differences
- Module paths changed: `@tauri-apps/api/window` → `@tauri-apps/api/window` (still, but some v1 paths may not exist)
- v2 uses capabilities instead of allowlist
- `tauri::Builder::default()` replaces `tauri::Builder::default()` (same but capability integration differs)
- `isTauri()` is synchronous in v2
- Always check `@tauri-apps/api` version 2.x, not 1.x

### 9.3 Linux Dependencies
Tauri on Linux requires system packages:
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### 9.4 Icon Generation
Use `tauri icon path/to/icon.png` to generate all platform icons automatically.

### 9.5 Dev Workflow
- `tauri dev` starts both Vite dev server AND the Tauri webview
- Hot reload works for frontend changes
- Rust changes require recompilation (tauri watches Cargo.toml)
- Close the Tauri window to stop the dev server

### 9.6 Bundle Targets
- Linux: `.deb`, `.AppImage`, `.rpm`
- macOS: `.dmg`, `.app`
- Windows: `.msi`, `.exe`
- Configure in `tauri.conf.json` → `bundle.targets`
