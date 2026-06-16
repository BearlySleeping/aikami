# Tauri Desktop App — Development Guide

Status: **Experimental** — basic rendering & navigation works; networking/assets have limitations.

---

## Quick Start

```bash
# Default: build + launch Tauri, navigate to /dev/sandbox
bun preview --tauri --force

# Open at root instead of /dev/sandbox
bun preview --tauri --no-dev

# Build only (no launch)
bun run moon run client:tauri-build
```

The `--force` flag skips moon caching and rebuilds everything. Required after any
source change that affects the build output.

---

## What Works

| Feature | Status |
|---------|--------|
| SvelteKit SPA renders | ✅ |
| Navigation to `/dev/sandbox` | ✅ |
| PixiJS v8 rendering | ✅ |
| Game engine (ECS) | ✅ |
| Web Workers | ✅ |
| Auth (anonymous, emulator) | ✅ |
| App Check (emulator) | ✅ |
| Keyboard input | ✅ |
| Layout & styling (Tailwind) | ✅ |

---

## Known Limitations

### 1. CSP (Content Security Policy)

Tauri uses a strict CSP in `tauri.conf.json`. Every external service, protocol,
and content type must be explicitly allowlisted.

**Current CSP:**
```
default-src 'self' tauri: asset:
script-src 'self' https://apis.google.com https://*.gstatic.com
style-src 'self' 'unsafe-inline' https://*.googleapis.com
connect-src 'self' tauri: asset: https://*.googleapis.com https://*.firebaseio.com
  wss://*.firebaseio.com https://*.firebasedatabase.app https://*.gstatic.com
  https://identitytoolkit.googleapis.com
img-src 'self' data: blob: tauri: asset: https://*.googleapis.com
font-src 'self' data:
worker-src 'self' blob:
frame-src 'self' https://*.firebaseapp.com
```

### 2. `createImageBitmap` Fails on `tauri://` Protocol

PixiJS's asset loader uses `createImageBitmap()` which cannot decode images
loaded via the `tauri://assets/` custom protocol.

**Symptom:**
```
[Loader.load] Failed to load tauri://assets/images/tilesets/debug_tiles.png.
InvalidStateError: Cannot decode the data in the argument to createImageBitmap
```

**Workaround (not yet implemented):**  
Configure PixiJS to prefer `HTMLImageElement` loading over `createImageBitmap`
when running inside Tauri. Or serve asset images via a different mechanism.

### 3. PixiJS `unsafe-eval` in CSP

PixiJS v8 uses `eval()` for shader compilation. Tauri's CSP blocks `eval()`.

**Fix applied:** `import 'pixi.js/unsafe-eval'` as a side-effect import at the
top of `packages/frontend/engine/src/pixi_app.ts` before any other PixiJS import.
This installs polyfills that replace `eval()` with `new Function()`.

**Files touched:**
- `packages/frontend/engine/src/pixi_app.ts` — added `import 'pixi.js/unsafe-eval'`
- `apps/frontend/client/src-tauri/tauri.conf.json` — CSP directives

### 4. Web Workers (ECS Worker)

**Root cause:** Vite's production build uses `worker.format: 'es'` which forces
`{type:'module'}` on worker constructors. The built worker file contains dynamic
`import()` calls that Tauri's webview rejects with a syntax error.

**Fix applied:** Switched to Vite's `?worker` import syntax:
```typescript
// packages/frontend/engine/src/game_world.ts
import EcsWorker from './worker/ecs_worker.ts?worker';
// ...
this._worker = new EcsWorker();
```

This tells Vite to build the worker as a separate chunk and return a constructor
function. Combined with `worker.format: 'iife'` in `vite.config.ts`.

**Files touched:**
- `packages/frontend/engine/src/game_world.ts` — replaced `new Worker(new URL(...))`
  with `?worker` import
- `apps/frontend/client/src/vite-worker.d.ts` — type declarations for `*?worker`
- `apps/frontend/client/vite.config.ts` — `worker.format: 'iife'`

### 5. Firebase / HTTPS Services

Tauri's dev webview lacks full TLS support. HTTPS requests to
`https://apis.google.com`, `https://identitytoolkit.googleapis.com`, etc. fail.

**Symptom:**
```
Failed to load resource: TLS support is not available (api.js)
```

**Impact:** Firebase Auth via Google sign-in doesn't work in Tauri dev mode.
Anonymous auth (no network) and email/password work with the emulator.

**Possible future fix:** Use Tauri's Rust HTTP client (`tauri-plugin-http`) to
proxy Firebase requests through the native networking stack.

### 6. LPC Sprite Assets

LPC character sprites are stored in Firebase Storage and must be downloaded
locally before building for Tauri.

**Current flow:**
1. `download_lpc_assets.ts` downloads from Firebase Storage to `src/lib/assets/lpc/`
2. Files are copied to `static/lpc/` (for Vite build inclusion)
3. `bun preview --tauri` runs this automatically

**Requires:** Firebase emulator running (`bun run emulate`) when downloading
from emulator mode.

### 7. `text/html` MIME Type Warning

```
Unhandled Promise Rejection: TypeError: 'text/html' is not a valid JavaScript MIME type.
```

This is a non-critical warning from dynamic imports. Some chunks are loaded as
modules and the Tauri webview reports the MIME type issue. Does not affect
functionality.

### 8. Canvas Area Warning

```
Canvas area exceeds the maximum limit (width * height > 268435456).
```

PixiJS warns when the canvas exceeds ~268M pixels. This occurs when the window
is large and the canvas auto-resizes. Harmless — can be addressed by setting
max canvas dimensions.

### 9. GStreamer Warning

```
GStreamer element appsink not found. Please install it.
```

Harmless. Tauri checks for GStreamer video plugins at startup. Not needed
for Aikami's rendering stack.

---

## Configuration Reference

### `tauri.conf.json`

Key settings:
```jsonc
{
  "build": {
    "devUrl": "http://localhost:5274",       // Vite dev server
    "frontendDist": "../build",              // Production build output
    "beforeBuildCommand": "bun run build:emulator"
  },
  "app": {
    "security": {
      "csp": "..."  // See CSP section above
    }
  }
}
```

### `vite.config.ts`

```typescript
worker: {
  // MUST be 'iife' for Tauri — 'es' causes worker syntax errors
  format: 'iife',
},
```

### `lib.rs` — Route Navigation

The Tauri binary accepts a `--route <path>` argument:
```
./target/debug/aikami --route /dev/sandbox
```

This is handled by `parse_startup_route()` in `src-tauri/src/lib.rs`.

---

## Files Changed (Tauri Support)

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Added `--route` CLI arg parsing + navigation |
| `src-tauri/tauri.conf.json` | Expanded CSP (fonts, workers, Firebase, assets) |
| `packages/frontend/engine/src/pixi_app.ts` | `import 'pixi.js/unsafe-eval'` |
| `packages/frontend/engine/src/game_world.ts` | `?worker` import for ECS worker |
| `apps/frontend/client/vite.config.ts` | `worker.format: 'iife'` |
| `apps/frontend/client/src/vite-worker.d.ts` | Type declarations for `*?worker` |
| `scripts/src/lib/ops/preview.ts` | Unified preview script with `--tauri` flag |
| `scripts/src/lib/ops/pixi_devtools.ts` | PixiJS DevTools extension manager |
| `package.json` | Added `"preview"` script |

---

## Future Work

- [ ] Fix `createImageBitmap` for `tauri://` protocol images
- [ ] Proxy Firebase HTTPS via Tauri Rust HTTP plugin
- [ ] Pre-download LPC assets as part of the build pipeline
- [ ] Test with staging/production Firebase (not just emulator)
- [ ] Add Tauri auto-updater
- [ ] Configure window icons, title, menu
- [ ] Handle window close/suspend gracefully
