# Cross-Origin Isolation & SharedArrayBuffer — Gotchas & Lessons Learned

**Summary**: The Aikami web client **does not use cross-origin isolation** (`crossOriginIsolated` is always `false`) and **contains no `SharedArrayBuffer` code**. This was a deliberate decision driven by Firebase Auth popup sign-in, and it matches the hub and the Tauri desktop build.

## Google Sign-In Popup Fails Under Strict COOP

**Problem**: Google sign-in failed on `aikami.bearlysleeping.com` with `FirebaseError: auth/popup-closed-by-user` after the popup opened. The same sign-in worked on `hub.bearlysleeping.com`.

**Root cause**: The client served `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (for SharedArrayBuffer/TTS). Firebase Auth's `signInWithPopup` opens a **cross-origin** popup at the auth handler (`aikami-production.firebaseapp.com/__/auth/handler` — the `PUBLIC_FIREBASE_AUTH_DOMAIN`) and relays the result back through `window.opener.postMessage()`. Under strict `COOP: same-origin`:

- The popup is placed in a different browsing-context group → `window.opener` is severed.
- The SDK's `pollUserCancellation` (`firebase_auth.js`, `PopupOperation`) reads `authWindow.window.closed`, which Chrome reports as `true` for a cross-group popup (logging *"Cross-Origin-Opener-Policy policy would block the window.closed call"*). It arms an 8-second grace timer and rejects with `auth/popup-closed-by-user` — even if the user completes Google sign-in.

**Fix**: Serve `Cross-Origin-Opener-Policy: same-origin-allow-popups` and **no** `Cross-Origin-Embedder-Policy` (`apps/frontend/client/firebase.json`). The popup keeps `window.opener`; sign-in resolves in-page exactly like the hub. Verified end-to-end in headed Chrome: popup opens, `window.opener` is present in the popup, no early rejection while the popup is open.

## There Is No Header Combination That Gives Both

Empirically verified in Chrome 151 (headless and headed, local test server with exact headers):

| COOP | COEP | `crossOriginIsolated` | `SharedArrayBuffer` | Popup works? |
| --- | --- | --- | --- | --- |
| `same-origin` | `require-corp` | ✅ `true` | ✅ yes | ❌ no (opener severed) |
| `same-origin-allow-popups` | `require-corp` | ❌ `false` | ❌ undefined | ✅ yes |
| `same-origin-allow-popups` | *(none)* | ❌ `false` | ❌ undefined | ✅ yes |

Chrome only grants `crossOriginIsolated` when COOP is **exactly** `same-origin` (spec wording notwithstanding). `same-origin-allow-popups` preserves popup openers but never enables SharedArrayBuffer. Since popup sign-in is a hard requirement, isolation is off.

## What We Gave Up (and the Fallbacks)

1. **Engine zero-copy state transfer** → the N-buffer `ArrayBuffer` transfer cycle (`createEngineBuffer` in `packages/frontend/engine/src/config/memory_config.ts` always returns `ArrayBuffer`; worker ↔ main exchange via transferable `postMessage` + `RECYCLE_BUFFER`). Cost: one copy per frame. Documented fallback (contract C-022).
2. **sqlite-wasm OPFS VFS** → IndexedDB-snapshotted database. Still persists across reloads; OPFS is more robust under disk pressure/quotas.
3. **Kokoro streaming TTS pipeline (C-211)** → the `SharedArrayBuffer` ring-buffer + `AudioWorkletProcessor` path was **removed** (`wait_free_ring_buffer.ts`, `kokoro_stream_worker.ts`, `kokoro_audio_worklet.ts` deleted). TTS now uses either the Kokoro REST server (docker/local dev — fetch full WAV and play) or the WebGPU worker (`kokoro_worker.ts`, kokoro-js offline synthesis). Neither needs SAB.

## Why Tauri Never Had It Either

The Tauri desktop build runs in system webviews (WebKitGTK on Linux, WKWebView on macOS), which **do not implement `SharedArrayBuffer` at all**. `tauri.conf.json` already dropped COOP/COEP ("for zero benefit"). So the desktop app has always used the ArrayBuffer fallback path — the web build now matches it.

## Docker / Local Dev Behavior

- **Emulator dev** (`vite dev --mode emulator`): no COOP/COEP headers (the old vite plugin that injected them was removed) → not isolated → popup works against the Auth emulator.
- **Docker local-stack** (`apps/backend/local-stack`, nginx on port 3000): serves the static client with no COOP/COEP → not isolated.
- **Kokoro server detected** (docker/dev): `checkKokoroServer()` probes `/api/voice`, `localhost:8880`, `127.0.0.1:8880`; when found, `synthesize()`/`speak()` fetch full WAV from the server. When not found, the WebGPU worker handles TTS.

Before this change, the SAB streaming pipeline was attempted whenever a Kokoro server was detected, then **failed at `new SharedArrayBuffer`** in every non-isolated context (dev, docker, and after the COOP change), leaving `status: 'error'` and skipping the WebGPU fallback — i.e., TTS was silently broken in docker/emulator. Removing the pipeline fixed that.

## Verification Evidence

- Headed Chrome 151 (Playwright) against the live site: `self.crossOriginIsolated === false`, popup opens to `__/auth/handler?authType=signInViaPopup`, `window.opener` present, no COOP console errors while the popup is open, no early `popup-closed-by-user`.
- Local test server (exact header combos) confirming the table above.
- Repo-wide scan: no `SharedArrayBuffer` / `Atomics` / `crossOriginIsolated` gating remains in `apps/frontend/client/src` or `packages/frontend/engine/src` (comments referencing the removed path are historical).

## Rules Going Forward

- Keep `COOP: same-origin-allow-popups`, never add COEP back (see `docs/architecture/limitations.md` → *Cross-Origin Isolation (COOP/COEP) — Do Not Re-enable*).
- Never reintroduce `SharedArrayBuffer`/`Atomics`-gated code in the client or engine.
- If SharedArrayBuffer is ever truly needed on the web build again, sign-in must move to the redirect flow (`signInWithRedirect`, no popup) — that is the only way to keep strict COOP.
- A future TTS binary should be deployed as a **server** (Cloud Run — the voice service `apps/backend/voice` already has a Dockerfile) or run in-browser via WebGPU/WASM; Firebase Hosting is static-only and never runs binaries.
