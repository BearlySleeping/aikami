// packages/frontend/engine/src/assets/custom_scheme_url_resolver.ts
//
// PixiJS asset URL resolution for pages served from a custom URI scheme
// (Tauri's `tauri://`, `file://`, etc.).
//
// Why this is needed:
// PixiJS's path utilities only understand http(s) URLs. For a `tauri://localhost/`
// page, `path.rootname(document.baseURI)` returns `tauri://` — the scheme with
// `://` but NO host — so a root-relative asset path like `/game-data/x.png`
// gets rewritten to `tauri://game-data/x.png`, where the FIRST path segment
// becomes the URL host. Tauri's protocol handler only serves `tauri://localhost/*`
// from the embedded frontend bundle; any other host falls back to the SPA
// index.html, and `createImageBitmap(htmlBlob)` fails with
// "Cannot decode the data in the argument to createImageBitmap".
//
// Fix: set `Assets.resolver.rootPath` to the page origin. The resolver then
// passes an explicit customRootUrl into `path.toAbsolute()`, bypassing the
// broken `rootname()`:
//   toAbsolute('/game-data/x.png', undefined, 'tauri://localhost/')
//     → path.join('tauri://localhost/', 'game-data/x.png')
//     → 'tauri://localhost/game-data/x.png'   ✓
//
// This runs on BOTH resolver paths (Assets.add and the raw-key resolve
// fallback), is scheme-agnostic (on http/https it evaluates to the same
// origin and produces byte-identical URLs to today's behavior), and is a
// no-op for absolute/blob/data URLs.
//
// Registered at module scope, exactly once (idempotent guard).

import { Assets } from 'pixi.js';

/** Whether the resolver has been patched (idempotent guard). */
let _patched = false;

/** Applies the rootPath fix once, before any Assets.load()/resolve() call. */
const _patchResolver = (): void => {
  if (_patched) {
    return;
  }
  _patched = true;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  // The page origin (e.g. `tauri://localhost/`, `http://localhost:5274/`).
  // Browser URL parser handles custom schemes correctly, unlike pixi's posix
  // path utilities.
  Assets.resolver.rootPath = new URL('/', document.baseURI).href;
};

_patchResolver();
