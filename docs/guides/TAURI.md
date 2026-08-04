# Tauri Desktop App — Development Guide & Debugging Notes

Status: **On hold / experimental.** The SPA, asset pipeline and boot pipeline work
in the Tauri webview, but **WebKitGTK WebGL stalls the game engine init** on Linux
(see Known Limitations #3) and the GPU hangs documented below. Use the browser for
game-rendering work; use Tauri for IPC/filesystem/window integration checks.

---

## Quick Start

```bash
# Recommended dev loop — herdr dev server + Tauri window pointed at it (no SvelteKit rebuild)
bun preview --tauri-dev               # opens /dev/sandbox; logs via `herdr_session read client`
bun preview --tauri-dev --software-gl # force llvmpipe (software GL) — no GPU-accelerated rendering
bun preview --tauri-dev --no-dev      # open at root instead of /dev/sandbox

# Embedded-mode smoke test (compiles WITHOUT the dev server; exercises tauri:// asset serving)
bun preview --tauri

# Plain browser (primary frontend dev loop — Chromium + PixiJS DevTools)
bun preview
```

**Why `--tauri-dev` exists:** `tauri.conf.json`'s `build.devUrl` is only used when
the Rust binary is compiled **without** the `custom-protocol` feature
(`tauri-build` sets `cfg(dev) = !custom-protocol`). `preview_client.ts --tauri-dev`
does exactly that (plain `cargo build`), then launches the binary directly against
the herdr Vite server on `http://localhost:5274`. `--tauri` builds with
`--features tauri/custom-protocol` so the frontendDist is embedded (production mode).

---

## What Works / What Doesn't (as of 2026-08)

| Area | Status |
|------|--------|
| SvelteKit SPA renders (embedded + devUrl) | ✅ |
| Asset registry (sqlite-wasm) seeds | ✅ (needs `'wasm-unsafe-eval'` in CSP) |
| `/game-data/**` asset serving via `tauri://localhost` | ✅ (needs the pixi `rootPath` fix) |
| `tauri://` route navigation (`--route`, `WebviewUrl::App`) | ✅ |
| Console → stdout forwarding (`tauri-plugin-log`) | ✅ |
| Web Workers (ECS worker) | ✅ (module worker file; do NOT inline) |
| **Game engine init (`createPixiApp` → WebGL)** | ❌ **stalls in WebKitGTK** (see #3) |
| Firebase HTTPS / Google sign-in | ❌ TLS in WebKitGTK (see #4) |
| GPU stability (i915) | ⚠️ hangs without `WEBKIT_DMABUF_RENDERER_FORCE_SHM` (see #5) |

---

## Known Limitations & Debugging Notes

### 1. PixiJS mangles `tauri://` URLs — root-relative assets become cross-host (FIXED)

**Symptom:**
```
[Loader.load] Failed to load tauri://game-data/sprites/tilesets/debug_tiles.png.
InvalidStateError: Cannot decode the data in the argument to createImageBitmap
```

**Root cause:** PixiJS `path.toAbsolute()` (node_modules/pixi.js/lib/utils/path.js)
only understands http(s) URLs. For a `tauri://localhost/...` page:
- `path.isUrl('tauri://localhost/a')` → `false` (regex is `/^https?:/`)
- `path.rootname('tauri://localhost/dev/sandbox')` → `'tauri://'` (scheme + `://`, no host)

So `/game-data/x.png` → `path.join('tauri://', 'game-data/x.png')` →
**`tauri://game-data/x.png`** — the first path segment becomes the URL **host**.
Tauri's protocol handler (`tauri-2.11.2/src/protocol/tauri.rs`) only serves
`tauri://localhost/*` from embedded assets; any other host falls through to the
SPA `index.html` (never a 404), so PixiJS decodes HTML as an image.

**Fix:** `packages/frontend/engine/src/assets/custom_scheme_url_resolver.ts` sets
```ts
Assets.resolver.rootPath = new URL('/', document.baseURI).href;
```
at module scope. The resolver then passes an explicit `customRootUrl` into
`toAbsolute`, bypassing the broken `rootname()`. Scheme-agnostic — on http(s) it
evaluates to the same origin and produces byte-identical URLs.

> ⚠️ Do NOT "fix" this with a custom `ResolveParser` extension: pixi's built-in
> `resolveTextureUrl` registers first at the same priority and wins the parser
> `find()` for every image, so a custom parser never fires for images.

### 2. ECS worker — must be a real module file, never `?worker&inline`

`game_world.ts` imports `./worker/ecs_worker_bootstrap.ts?worker&type=module`.
The bootstrap dynamic-imports `./ecs_worker.ts`. With `?worker&inline`, Vite
inlines the bootstrap as a **blob/data: URL worker**; a relative dynamic import
cannot resolve against a blob base → the worker never evaluates → `LOAD_MAP`
times out (15s) in production builds (works in dev because Vite serves a real
path). Non-inline (`?worker&type=module`) emits a real file whose dynamic-import
chunk resolves at its emitted URL.

### 3. WebKitGTK WebGL stalls the engine — the big blocker

Both embedded and dev-mode Tauri boot cleanly (asset registry seeds, content pack
loads, `lpc.boot.*` logs) then **hang silently inside `createPixiApp()`
(`app.init({ preference: 'webgl' })`)** — no error, no timeout, the promise never
settles. The browser (Chromium) completes the same boot fine.

- WebKitGTK added WebGL2 via a fresh ANGLE port only in 2.40 (2023); the path is
  immature (open upstream issues: tauri#6559 "WebGL context lost", WebKitGTK
  hangs on Gen12 iGPU classes).
- You cannot detect hardware vs software GL: WebKitGTK spoofs
  `WEBGL_debug_renderer_info` to `"Apple GPU"` on Linux.
- **Recommendation (roadmap):** a Chromium-based shell for Linux (keep Tauri for
  Windows/macOS where WebView2/WKWebView are fine), or a browser-launched PWA.

### 4. Firebase HTTPS / TLS in WebKitGTK

```
Failed to load resource: TLS support is not available (api.js)
```
HTTPS to `apis.google.com` / `identitytoolkit.googleapis.com` fails in WebKitGTK.
Anonymous auth + the emulator work; Google sign-in does not. Possible future fix:
proxy via `tauri-plugin-http`.

### 5. GPU hangs / laptop freezes (i915) — how to stay safe

Running the Tauri webview (WebKitGTK) on this hybrid-GPU Linux laptop wedged the
Intel i915 GPU (kernel: `GPU HANG ... in WebKitWebProces`, `Resetting rcs0 for
preemption time out`) → whole screen frozen with audio still playing; only reboot
recovers. WebKitGTK ≥2.44 renders via the DMA-BUF path, and the web process picks
a GBM device independently of the UI process — on hybrid GPUs that is a known
source of cross-device blits/hangs.

**App-side mitigations (baked into `preview_client.ts`):**
- `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` — keeps compositing, avoids the DMA-BUF
  import path. (`WEBKIT_DISABLE_DMABUF_RENDERER` is a dead end on WebKitGTK ≥2.44 —
  the X11/WPE renderers were removed.)
- `--software-gl` → `LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe` — fully
  contained, safe for correctness/UI work (not perf).
- COOP/COEP headers were **removed** from `tauri.conf.json`: WebKitGTK does not
  implement SharedArrayBuffer at all (browser-only), and COOP/COEP forces a
  WebKitGTK process-model change (isolated webprocess) for zero benefit.

### 6. CSP — stylesheet refusals & WASM

- **WASM (sqlite-wasm)**: `script-src` must include `'wasm-unsafe-eval'` or the
  local asset-registry DB fails to load (`stage:initializing_asset_registry:degraded`).
- **Stylesheet refusals** (`Refused to apply a stylesheet ... style-src`): Tauri
  appends nonces/sha256 hashes to `style-src` at build time; per CSP3, once a
  directive contains any nonce/hash source, `'unsafe-inline'` is ignored — so
  runtime-injected styles (Svelte/daisyUI) get refused. Fix (in tauri.conf.json):
  ```json
  "dangerousDisableAssetCspModification": ["style-src"]
  ```
  which keeps script-src hardening but restores `'unsafe-inline'` for styles.

### 7. Debugging the webview — three reliable channels

1. **Console → stdout**: `tauri-plugin-log` (Rust) + `tauri_console_log.ts`
   (client, monkey-patches `console.*`) forward page logs to the app's stdout and
   `~/.local/share/com.aikami.app/logs/Aikami.log`. In dev mode they also arrive
   at `herdr_session read client` via the app's `/api/logs` sink.
2. **WebInspector**: Ctrl+Shift+I / right-click → Inspect (dev builds enable
   developer extras). `WEBKIT_INSPECTOR_SERVER` is NOT wired by wry/Tauri.
3. **Rust-side `log::debug!`**: the `tauri::manager` asset fallback lines prove
   which paths Tauri serves (e.g. `Asset x not found; fallback to index.html`).

> `window.eval(...)` in `lib.rs` gives **no** feedback on wry/WebKitGTK (result is
> discarded) — don't use it to probe page state.

---

## Dev / Debug Workflow

1. **Browser first** (`bun preview` → Chromium + PixiJS DevTools). ~95% of
   frontend work. No WebKit, no GPU-hang risk.
2. **Tauri dev-mode integration** (`bun preview --tauri-dev`): IPC, filesystem,
   window behavior; logs via herdr.
3. **Still hangs** → `bun preview --tauri-dev --software-gl`.
4. **Embedded smoke test** (`bun preview --tauri`): the ONLY path that exercises
   `tauri://localhost` asset serving. Run at least once per asset-pipeline change.
   Expect it to stall at the WebGL init (#3) — verify the boot logs get past
   `initializing_asset_registry` / `preloading_content`.

---

## Configuration Reference

### `src-tauri/Cargo.toml`
- `tauri = { version = "2" }` — **no** `custom-protocol` feature. `tauri dev` /
  plain `cargo build` compile with `cfg(dev)` so `devUrl` is used. The `tauri
  build` CLI adds `tauri/custom-protocol` automatically for production bundles;
  the embedded preview path builds with `--features tauri/custom-protocol`.

### `src-tauri/tauri.conf.json`
- `windows: []` — the main window is created programmatically in `lib.rs` via
  `WebviewWindowBuilder::new(app, "main", WebviewUrl::App(route))` so the startup
  route (`--route /dev/sandbox`) is baked into the app URL (resolves against
  `devUrl` in dev, `tauri://localhost/` in production).
- No COOP/COEP headers (see #5). `dangerousDisableAssetCspModification:
  ["style-src"]` (see #6). `'wasm-unsafe-eval'` in script-src (see #6).

### `scripts/src/lib/ops/preview_client.ts`
- `--tauri-dev`: herdr dev server + `cargo build` (no custom-protocol) + direct
  binary launch with `--route` + WebKit-safe env.
- `--tauri`: build client + `cargo build --features tauri/custom-protocol` +
  launch (embedded).
- `--software-gl`: llvmpipe fallback.

---

## Future Work

- [ ] Chromium-based Linux shell (WebKitGTK WebGL is not viable for the game engine)
- [ ] Proxy Firebase HTTPS via `tauri-plugin-http`
- [ ] Tauri auto-updater
- [ ] Window close/suspend handling
