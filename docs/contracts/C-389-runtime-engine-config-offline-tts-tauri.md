---
id: C-389
title: "Runtime Engine Configuration, Offline Browser TTS, and Tauri Packaging"
source: "user request — local-stack engine review: 'maybe kokoro can be only in-browser/tauri?' + 'include the tauri build, or just serve the client locally, like the dist folder'"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-13"
---

# Contract C-389: Runtime Engine Configuration, Offline Browser TTS, and Tauri Packaging

## Metadata

| Field | Value |
|---|---|
| **Source** | Local-stack engine review, 2026-08-13. Decisions: (a) TTS moves in-browser by default so the bundled stack ships one fewer service; (b) engine endpoints must become runtime config, because build-time baking is what currently makes a publishable client image impossible. |
| **Target** | `apps/frontend/client/` — build config, runtime config loader, `services/audio/`, `src-tauri/` |
| **Priority** | P0 — the build-time endpoint baking is the direct blocker on publishing any client container image to GHCR, which is the stated goal of the local-stack work. |
| **Dependencies** | None hard. C-390 depends on this. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | user-facing → "Configure your local engines" page in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Engine endpoints are baked at build time, so the client image is not publishable.**
  `apps/frontend/client/vite.config.ts:110` sets `envPrefix: ['PUBLIC_']`, and
  `apps/backend/local-stack/package.json` → `build:client` bakes them in:
  ```
  PUBLIC_OLLAMA_BASE_URL=${LLM_ENDPOINT:-http://localhost:8080/v1}
  PUBLIC_IMAGE_URL=${IMAGE_ENDPOINT:-http://localhost:8188}
  PUBLIC_VOICE_URL=${VOICE_ENDPOINT:-http://localhost:6006}
  ```
  A prebuilt image therefore hardcodes one topology. Changing a port, running
  the engines on another host, or switching image engines requires a **full
  SPA rebuild**. The local-stack README already documents the resulting
  footgun: `bun run build:client` must run before any `docker compose up`.

- **The Tauri desktop app can only reach the *old* engines.**
  `apps/frontend/client/src-tauri/tauri.conf.json` → `app.security.csp` allows
  in `connect-src` exactly two local origins: `http://localhost:11434`
  (Ollama) and `http://localhost:8188` (ComfyUI). `img-src` allows only
  `http://localhost:8188`. There is no entry for a `llama-server`, an
  `sd-server`, or any voice endpoint. Any engine migration is silently blocked
  by CSP in the desktop build.

- **The in-browser Kokoro worker cannot run in Tauri at all today, and is not offline-capable anywhere.**
  `apps/frontend/client/src/lib/services/audio/kokoro_worker.ts`:
  - `:18` — `env.allowLocalModels = false`, forcing weights to come from the HuggingFace CDN
  - `:69` — `ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.0/dist/'`
  - `:74` — `KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', { dtype: 'q8', device: 'webgpu' })`

  Neither `cdn.jsdelivr.net` nor any HuggingFace origin appears in the Tauri
  `connect-src`. In the desktop app the worker fails at initialisation. In the
  browser it works but requires internet on first use — a contradiction for an
  offline-first local AI stack.

- **The TTS service blind-probes a hardcoded port.**
  `tts_service.svelte.ts:620` probes `['/api/voice', 'http://localhost:8880', 'http://127.0.0.1:8880']`. The local-stack sherpa voice engine listens on **6006** (`docker-compose.yml`), so the bundled stack's TTS is unreachable by construction. Meanwhile the probe fires on every startup even when no voice service is configured.

- **Three TTS implementations exist for one feature**: `hwdsl2/kokoro-server` (`apps/backend/voice/Dockerfile`, port 8880, PyTorch), sherpa-onnx Kokoro (`local-stack/docker/voice/Dockerfile.sherpa`, port 6006), and the in-browser WebGPU worker.

- **Cross-origin isolation was just dropped, which changes the WASM fallback.**
  Commit `ce14406b` removed cross-origin isolation from the client (dropping
  `SharedArrayBuffer`), but `tauri.conf.json` still sets
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: credentialless`. Without
  `SharedArrayBuffer`, `onnxruntime-web`'s WASM backend is single-threaded —
  which is exactly the path taken when WebGPU is unavailable.

- **Existing implementation to reuse**: the worker's message protocol (`initialize` / `synthesize` → `ready` / `complete` / `error`) is sound and stays; `audio_queue_player.ts` and `audio_context_manager.ts` are engine-agnostic; `svelte.config.js:40` already uses `adapter-static` with `fallback: 'index.html'`, so the build output is a plain static `build/` directory suitable for any static host.

- **Known gaps**: no runtime config file, no local model hosting, no Tauri-side model fetch, no WebGPU capability gate, no way to disable the voice probe.

- **Baseline tests**: `tts_service.test.ts`, `audio_service.test.ts`, `audio_queue_player.test.ts` must pass first — `bun moon run client:test`.

## User Outcome

After this contract, a **player** can install the desktop app or open the
served `dist/`, enable speech with one deliberate button press that works
offline from then on with no container running, and point the app at any
engine host by editing one JSON file — no rebuild.

## Success Measures

- **Time/latency target**: runtime config fetch adds < 50 ms to boot; Kokoro first-token audio under 1.5 s on a WebGPU-capable machine after the model is cached.
- **Offline/degraded behavior**: after first successful model fetch, TTS works with the network fully disconnected. Without WebGPU, the WASM path is used and the UI states that speech will be slower. With neither, TTS is disabled and the rest of the app is unaffected.
- **Production journey enabled**: a prebuilt `aikami-client` image can be published to GHCR and reused unchanged across every stack topology — the prerequisite for C-390.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Static SPA build | `svelte.config.js:40` (`adapter-static`, `fallback: index.html`) | reuse unchanged |
| Build-time endpoint baking | `local-stack/package.json` → `build:client` | **replace** with runtime config |
| Kokoro worker protocol | `kokoro_worker.ts` message types | reuse |
| Kokoro asset sourcing | `kokoro_worker.ts:18,69,74` | replace — local/app-controlled origin |
| Voice server probe | `tts_service.svelte.ts:620` | modify — config-driven, opt-in |
| Audio playback | `audio_queue_player.ts`, `audio_context_manager.ts` | reuse unchanged |
| Tauri shell | `src-tauri/tauri.conf.json` | modify — CSP, resources, model fetch command |

## Overview

Replace build-time `PUBLIC_*` endpoint baking with a runtime `config.json`
loaded at boot, vendor the ONNX runtime and Kokoro weights so browser TTS
works offline and inside Tauri, widen the Tauri CSP to the engine ports the
new stack actually uses, and make the voice sidecar opt-in rather than
assumed. The result is one client artifact that works as a served `dist/`, as
a container, and as a desktop app.

## Design Reference

Follow the `packages/frontend/configs/src/lib/environment.ts` pattern for
where configuration is read, but change *when*: values resolve at runtime from
a fetched document, with the existing `PUBLIC_*` variables retained only as
compile-time **defaults** for the dev server.

Runtime config precedence, highest first:
1. `localStorage` override (developer escape hatch, dev builds only)
2. Tauri: config file in the app config directory, written by the installer/first run
3. Web: `GET /config.json` relative to the app origin
4. Compile-time `PUBLIC_*` defaults
5. Hardcoded localhost defaults

For Tauri model fetching, download through the **Rust side** (a Tauri command
using the HTTP plugin), not the webview. This bypasses webview CSP entirely,
avoids widening `connect-src` to arbitrary CDNs, and lets the app verify a
checksum before the bytes ever reach JavaScript.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **The SPA build must be topology-agnostic.** After this contract, no engine
  URL may be embedded in the bundle. `PUBLIC_*` engine URLs survive only as
  dev-server defaults.
- **`config.json` is served next to the SPA and is not part of the build
  output.** In the container it is a mounted file; served locally it sits
  beside `index.html`; in Tauri it lives in the app config directory. Missing
  or malformed → fall back to defaults and log once, never crash.
- **Browser TTS is the default; the voice sidecar is opt-in.** The probe at
  `tts_service.svelte.ts:620` must only run when `voice.url` is present in the
  runtime config. No blind localhost probing.
- **Kokoro assets are served from an app-controlled origin.** The ONNX runtime
  WASM binaries are vendored into the app's static assets. The Kokoro weights
  are fetched once from a configurable origin and cached (Cache API / OPFS in
  the browser, app data dir in Tauri), then loaded locally forever after.
- **The voice model download is explicit and user-triggered.** The weights are
  **not** bundled into the Tauri installer, and they are never fetched
  implicitly on first speech. TTS starts in a `not-downloaded` state and the
  settings UI offers a "Download voice model" button showing the size before
  the user commits. A multi-tens-of-megabyte transfer is the user's decision,
  not a side effect of clicking play — this matters most on metered
  connections, where an automatic fetch is a real cost.
- **The Tauri CSP must enumerate the new engine ports** and must not gain a
  CDN entry — Rust-side fetching is what removes that need.
- **Reconcile the COEP/COOP headers with the post-`ce14406b` reality.** Either
  restore cross-origin isolation (and gain threaded WASM) or drop the headers
  from `tauri.conf.json` so the two builds behave identically. Do not leave
  them disagreeing.
- **Do not delete the voice containers.** They stop being required for TTS;
  they remain the STT host and the advanced/GPU TTS option.

## State & Data Models

```jsonc
// config.json — served beside index.html; every field optional
{
  "text":  { "url": "http://localhost:11434/v1", "model": "qwen3-4b-instruct" },
  "image": { "url": "http://localhost:8188", "engine": "auto" },
  "voice": {
    "tts": { "mode": "browser", "url": null },
    "stt": { "url": null }
  },
  "models": { "originUrl": "https://huggingface.co" }
}
```

```ts
/** Where speech synthesis runs. */
type TtsMode = 'browser' | 'server' | 'disabled';

/** Resolved at boot, immutable thereafter. */
type RuntimeEngineConfig = {
  readonly text: { readonly url: string; readonly model?: string };
  readonly image: { readonly url: string; readonly engine: 'auto' | 'sdcpp' | 'comfyui' };
  readonly voice: {
    readonly tts: { readonly mode: TtsMode; readonly url?: string };
    readonly stt: { readonly url?: string };
  };
  /** Base origin for one-time model asset downloads. */
  readonly models: { readonly originUrl: string };
};

/** Reported by the TTS service so the UI can explain degraded speech. */
type TtsBackend = 'webgpu' | 'wasm' | 'server' | 'unavailable';

/** Lifecycle of the on-demand voice model download. */
type VoiceModelState =
  | { readonly status: 'not-downloaded'; readonly bytes: number }
  | { readonly status: 'downloading'; readonly receivedBytes: number; readonly totalBytes: number }
  | { readonly status: 'verifying' }
  | { readonly status: 'ready' }
  | { readonly status: 'error'; readonly message: string; readonly retryable: boolean };
```

TypeBox schema for `RuntimeEngineConfig` goes in
`packages/shared/schemas/`; the derived type in `packages/shared/types/`.
Validate the fetched document against the schema and fall back on failure.

## Quality Requirements

- **Offline/degraded mode**: after first model fetch, no network required for TTS. Config fetch failure is non-fatal.
- **Accessibility/input**: when TTS falls back to WASM or becomes unavailable, surface it as visible text, not only a console warning — a screen-reader user needs to know speech is off.
- **Performance budget**: config fetch < 50 ms; vendored ORT WASM must not enter the initial bundle — load it only when TTS initialises.
- **Security/privacy**: validate `config.json` against the schema; reject non-`http(s)` engine URLs. Verify a SHA-256 checksum on every downloaded model before use. Do not widen the Tauri CSP to wildcard hosts.
- **Persistence/migration**: cached model assets survive app updates; a checksum mismatch triggers re-download rather than a hard failure.
- **Cancellation/retry/idempotency**: model download is resumable and idempotent; a second call while one is in flight joins the existing download rather than starting another.
- **Observability**: log resolved config source (localStorage / file / HTTP / defaults) once at info; log the selected `TtsBackend` once at info.

## Migration & Rollback

- **Old data compatibility**: existing installs have no `config.json`. Absence resolves to the compile-time defaults, which equal today's values — no user-visible change on upgrade.
- **Migration**: none required for user data. `local-stack/package.json` → `build:client` drops its `PUBLIC_*` prefix and instead emits a `config.json` into the staged output.
- **Rollback**: the compile-time `PUBLIC_*` defaults remain wired, so a build with the old env vars set still produces a working (if inflexible) client.
- **Feature flag or kill switch**: `voice.tts.mode` — `browser` | `server` | `disabled` covers every rollback case for the TTS change without a redeploy.
- **Failure recovery**: a corrupt cached model is detected by checksum and re-fetched; if re-fetch fails, TTS reports `unavailable` and the app continues.

## Scope Boundaries

- **In Scope:**
  - Runtime config loader, schema, precedence chain, and removal of build-time endpoint baking.
  - Vendoring ORT WASM; app-controlled Kokoro weight fetch with checksum + cache.
  - An explicit "Download voice model" control in settings, with size shown up front, progress, cancel, and delete — plus the `VoiceModelState` surface behind it.
  - WebGPU capability detection and honest `TtsBackend` reporting.
  - Making the voice-server probe config-gated.
  - Tauri: CSP update for the new engine ports, Rust-side model download command, COEP/COOP reconciliation.
  - A `serve` path for the built `dist/` (static file server) documented as the no-Docker option.
- **Out of Scope:**
  - Any compose/Docker topology work — C-390.
  - STT implementation. This contract only reserves `voice.stt.url` in the config shape; the consumer is C-359 (Speech Input and Hands-Free Play).
  - Deleting `apps/backend/voice` or the sherpa container.
  - Voice cloning or non-Kokoro TTS engines.
  - Tauri auto-updater changes (`plugins.updater` stays as-is).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** runtime config and offline browser TTS look separable
but are not — both are blocked by the same Tauri CSP, and shipping offline TTS
without runtime config would hardcode the model origin, recreating the exact
problem being fixed. Splitting would leave the desktop app broken in between.
Kept as one contract.

## Acceptance Criteria

### AC-1: No engine URL survives in the bundle
**Given** a production build produced without any `PUBLIC_*_URL` env var set
**When** the built assets in `build/` are searched for `localhost:8188`, `localhost:11434`, `localhost:6006`, and `localhost:8880`
**Then** no engine URL appears in any emitted JS chunk.

### AC-2: Runtime config drives the engines
**Given** a `config.json` served beside `index.html` pointing `text.url` and `image.url` at non-default ports
**When** the app boots and issues its first engine request
**Then** the request targets the configured ports, with no rebuild.

### AC-3: Config precedence and safe fallback
**Given** no `config.json` exists, or it returns 404, or it is malformed JSON, or it fails schema validation
**When** the app boots
**Then** defaults apply, exactly one warning is logged, and the app renders normally in all four cases.

### AC-4: Browser TTS works fully offline after first use
**Given** TTS has successfully synthesised once and the model is cached
**When** the network is disconnected and the app is reloaded
**Then** synthesis still succeeds, and no request to any external origin is attempted.

### AC-4b: The voice model is never downloaded implicitly
**Given** a fresh install where the voice model has never been fetched
**When** the user triggers speech
**Then** no download starts — TTS reports `not-downloaded`, the UI directs the user to the download control, and the app remains fully usable without speech.

### AC-4c: The download control is explicit, cancellable, and reversible
**Given** the settings UI on a fresh install
**When** the user opens the voice section
**Then** a "Download voice model" button is shown with the download size; pressing it reports progress; cancelling mid-download leaves no partial model in use and the state returns to `not-downloaded`; after completion a delete control removes the cached model and returns to `not-downloaded`.

### AC-4d: The Tauri installer does not carry the weights
**Given** the packaged desktop installer
**When** its contents and size are inspected
**Then** no Kokoro `.onnx` weight file is bundled, and the installer size shows no corresponding increase over the pre-contract baseline.

### AC-5: Kokoro initialises inside Tauri
**Given** the packaged desktop app on a machine with WebGPU
**When** the user presses the download control and then triggers speech
**Then** the model is fetched by the Rust side, checksum-verified, cached in the app data directory, and synthesis succeeds — with no CSP violation in the webview console.

### AC-6: WebGPU absence degrades honestly
**Given** a runtime without WebGPU
**When** TTS initialises
**Then** the WASM backend is used, `TtsBackend` reports `'wasm'`, and the UI states that speech will be slower — it does not silently hang or report `ready` while unusable.

### AC-7: No blind voice probing
**Given** `voice.tts.mode === 'browser'` and `voice.tts.url` is absent
**When** the app boots and TTS initialises
**Then** no request to `localhost:8880` or any other voice port is made.

### AC-8: Server TTS mode still works, on the configured port
**Given** `voice.tts.mode === 'server'` and `voice.tts.url` set to the sherpa engine
**When** speech is requested
**Then** `POST {url}/v1/audio/speech` is called and audio plays — proving the sidecar remains a first-class option on a non-8880 port.

### AC-9: Tauri CSP admits the new engines
**Given** the packaged desktop app configured for a `llama-server` and an `sd-server`
**When** text and image generation are exercised
**Then** both succeed with no CSP violation, and `connect-src` contains no wildcard host and no CDN.

### AC-10: `dist/` serves standalone
**Given** a production build
**When** the `build/` directory is served by any static file server with SPA fallback and a `config.json` placed beside `index.html`
**Then** the app loads and reaches its configured engines — no Node, no Docker, no SvelteKit server.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | build-output grep assertion in the client test suite | N/A | Filled during verification |
| AC-2 | Unit | `runtime_config.test.ts` | N/A | Filled during verification |
| AC-3 | Unit | `runtime_config.test.ts` — four failure modes | N/A | Filled during verification |
| AC-4 | Integration | `tts_service.test.ts` with offline fetch mock | `/game/...` | Filled during verification |
| AC-4b | Unit | `tts_service.test.ts` — asserts zero fetches on synthesize | N/A | Filled during verification |
| AC-4c | Unit + Visual | `voice_model_download.test.ts`, settings visual suite | settings route | Filled during verification |
| AC-4d | Manual | packaged installer size recorded in the PR | desktop app | Filled during verification |
| AC-5 | Manual | packaged Tauri build, documented in the PR | desktop app | Filled during verification |
| AC-6 | Unit | `tts_service.test.ts` — WebGPU absent | N/A | Filled during verification |
| AC-7 | Unit | `tts_service.test.ts` — asserts zero fetches | N/A | Filled during verification |
| AC-8 | Unit | `tts_service.test.ts` — server mode | N/A | Filled during verification |
| AC-9 | Manual | packaged Tauri build, console clean | desktop app | Filled during verification |
| AC-10 | Integration | `bun moon run local-stack:test` static-serve check | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`, `bun moon run client:typecheck`, `bun moon run client:build`
- Integration: serve `build/` with a static server, swap `config.json`, confirm the app follows it without a rebuild.
- E2E / Visual:
    - **Functional**: extend the existing client Playwright setup with a spec that boots against a stubbed `config.json` and asserts the outbound engine origin. POM: none needed beyond the existing app fixture.
    - **Visual**: N/A — no visual change.

**Watch Points**:
- `env.allowLocalModels = false` (`kokoro_worker.ts:18`) must be inverted, not merely supplemented, or transformers.js will keep preferring the remote copy.
- `onnxruntime-web` version must stay pinned to the vendored WASM binaries — a version skew between the JS and the `.wasm` files fails at runtime with an opaque error.
- Tauri's `dangerousDisableAssetCspModification: ["style-src"]` is already set; do not extend it to `connect-src` as a shortcut around AC-9.
- Cache API is unavailable on insecure origins. `http://localhost` is treated as secure, but a LAN IP over plain HTTP is not — the model cache silently fails there. Detect and warn.

## Implementation Sequence

1. **Phase 1 (Config)**: schema, loader, precedence chain, and consumer migration off `import.meta.env.PUBLIC_*` for engine URLs.
2. **Phase 2 (Assets)**: vendor ORT WASM; implement checksum-verified Kokoro fetch + cache; flip `allowLocalModels`.
3. **Phase 3 (TTS)**: WebGPU detection, `TtsBackend` reporting, config-gated server probe, UI state for degraded modes.
4. **Phase 4 (Tauri)**: CSP update, Rust model-download command, COEP/COOP reconciliation, packaged-build verification.
5. **Phase 5 (Serve)**: static-serve script for `build/` plus `config.json` emission; update `local-stack:build-client` to stop baking URLs.
6. **Phase 6 (Validation)**: `bun moon run client:test`, `:typecheck`, `:lint`, `:build`, plus a packaged Tauri smoke test.

## Edge Cases & Gotchas

- **Config fetched from a stale cache**: `config.json` must be served with `Cache-Control: no-store`, or a topology change will not take effect until a hard reload.
- **Two tabs, one model download**: concurrent first-use in two tabs must not double-download. Serialise on the Cache API entry.
- **WebGPU present but adapter request fails** (headless CI, blocklisted driver): treat as absent and fall back — do not let the promise hang.
- **Tauri on Linux is WebKitGTK**, where WebGPU is unreliable. The WASM path will be the common case there, and without `SharedArrayBuffer` it is single-threaded. Measure before assuming browser TTS is acceptable on Linux desktop; if it is not, `voice.tts.mode: 'server'` is the documented remedy.
- **Checksum drift**: if the upstream HF repo republishes the ONNX weights, the pinned checksum stops matching and every install breaks. Pin to a specific revision, not `main`.
- **`img-src` for generated images**: switching image engines changes the origin serving image blobs. Since C-388 fetches blobs and creates object URLs, `blob:` coverage matters more than the host entry — verify both are present.

## Open Questions

Must be resolved before status becomes `approved`:

- ~~Vendor the Kokoro weights into the Tauri installer, or download on first use?~~ **Resolved 2026-08-13 by the user:** neither implicit nor bundled — an explicit download **button**. The installer stays small, and the fetch is a deliberate user action. See AC-4b through AC-4d.
- Restore cross-origin isolation (threaded WASM, but re-opens the Google popup sign-in problem that `ce14406b` just solved) or accept single-threaded WASM? Proposed: accept single-threaded, since WebGPU is the primary path and the WASM path is a fallback.
- Should `config.json` be writable from the app's settings UI, or file-only? File-only is proposed for this contract; a settings UI is a follow-up.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
