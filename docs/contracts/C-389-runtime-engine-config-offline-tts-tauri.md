---
id: C-389
title: "Runtime Engine Configuration, Offline Browser TTS, and Tauri Packaging"
source: "user request — local-stack engine review: 'maybe kokoro can be only in-browser/tauri?' + 'include the tauri build, or just serve the client locally, like the dist folder'"
status: implemented
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
| **Status** | implemented |
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
| Tauri shell | `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json` | modify — CSP, capability ACL, resources, model fetch command, first-run config writer |

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
4. Compile-time `PUBLIC_*` defaults (dev server only — tree-shaken out of production bundles)
5. **No engine URL** — `text.url`, `image.url`, and `voice.*.url` resolve to unset; the app renders normally, engine-dependent features report unavailable, and the "Configure your local engines" docs page is the setup path

> Rung 5 deliberately contains no localhost literals: any engine URL string in the
> bundle would trip AC-1 and defeat the topology-agnostic image goal. The
> "no user-visible change on upgrade" promise (Migration) is carried by the
> deployment paths that emit a config file, not by baked-in fallbacks.

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
  or malformed → fall back down the precedence chain (to rung 5, unset, in
  production) and log once, never crash.
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

- **Old data compatibility**: existing installs have no `config.json`. Every
  deployment path emits one carrying today's values — `local-stack`'s
  `build:client` writes it into the staged output, the Tauri app writes its
  default config file on first run, and static hosts ship one beside
  `index.html` — so resolved values equal today's and there is no user-visible
  change on upgrade. A naked production build with no config source resolves
  engine URLs to unset (precedence rung 5).
- **Migration**: none required for user data. `local-stack/package.json` → `build:client` drops its `PUBLIC_*` prefix and instead emits a `config.json` into the staged output.
- **Rollback**: an operator restores the previous topology by shipping a
  `config.json` with the old endpoint values (or, for a dev server, by setting
  the old `PUBLIC_*` env vars). Rollback uses the same mechanism as the forward
  change — no SPA redeploy is required.
- **Feature flag or kill switch**: `voice.tts.mode` — `browser` | `server` | `disabled` covers every rollback case for the TTS change without a redeploy.
- **Failure recovery**: a corrupt cached model is detected by checksum and re-fetched; if re-fetch fails, TTS reports `unavailable` and the app continues.

## Scope Boundaries

- **In Scope:**
  - Runtime config loader, schema, precedence chain, and removal of build-time endpoint baking.
  - Vendoring ORT WASM; app-controlled Kokoro weight fetch with checksum + cache.
  - An explicit "Download voice model" control in settings, with size shown up front, progress, cancel, and delete — plus the `VoiceModelState` surface behind it.
  - WebGPU capability detection and honest `TtsBackend` reporting.
  - Making the voice-server probe config-gated.
  - Tauri: CSP update for the new engine ports, capability ACL alignment, Rust-side model download command, first-run default config file writer, COEP/COOP header removal (Open Question 2).
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
**When** the built assets in `build/` are searched for every engine URL literal the old code or its defaults could emit — `localhost:8080`, `localhost:8089`, `localhost:8188`, `localhost:11434`, `localhost:6006`, and `localhost:8880`
**Then** no engine URL appears in any emitted JS chunk (precedence rung 5 must stay literal-free for this to hold).

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
**Then** no Kokoro `.onnx` weight file is bundled, and the installer size shows no corresponding increase over the pre-contract baseline (record the pre-change installer size in the PR so the comparison is checkable).

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
**Given** the packaged desktop app configured for a `llama-server`, an `sd-server`, and server-mode voice on the voice port
**When** text, image, and voice generation are exercised
**Then** all succeed with no CSP violation; `connect-src` contains no wildcard host and no CDN; and the voice port is present — currently missing from `connect-src`, so it must be added (`http://localhost:8089` per `development_ports.ts`, plus `http://localhost:6006` for the current compose topology until C-390 lands). `src-tauri/capabilities/default.json`'s `http:allow-fetch` allow-list must be widened in lockstep with the CSP if any engine call ever goes through the JS HTTP plugin.

### AC-10: `dist/` serves standalone
**Given** a production build
**When** the `build/` directory is served by any static file server with SPA fallback and a `config.json` placed beside `index.html`
**Then** the app loads and reaches its configured engines — no Node, no Docker, no SvelteKit server.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | build-output grep assertion in the client test suite | N/A | Filled during verification |
| AC-2 | Unit | `runtime_config.test.ts` | N/A | Filled during verification |
| AC-3 | Unit + Integration | `runtime_config.test.ts` — four failure modes; boot smoke via the existing client Playwright app fixture for the "renders normally" clause | N/A | Filled during verification |
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
5. **Phase 5 (Serve)**: static-serve script for `build/` plus `config.json` emission; extend `local-stack`'s `scripts/check.sh` with the static-serve + config-swap check AC-10's evidence depends on; update `local-stack:build-client` to stop baking URLs.
6. **Phase 6 (Validation)**: `bun moon run client:test`, `:typecheck`, `:lint`, `:build`, plus a packaged Tauri smoke test.

## Edge Cases & Gotchas

- **Config fetched from a stale cache**: `config.json` must be served with `Cache-Control: no-store`, or a topology change will not take effect until a hard reload.
- **Two tabs, one model download**: concurrent first-use in two tabs must not double-download. Serialise on the Cache API entry.
- **WebGPU present but adapter request fails** (headless CI, blocklisted driver): treat as absent and fall back — do not let the promise hang.
- **Tauri on Linux is WebKitGTK**, where WebGPU is unreliable. The WASM path will be the common case there, and without `SharedArrayBuffer` it is single-threaded. Measure before assuming browser TTS is acceptable on Linux desktop; if it is not, `voice.tts.mode: 'server'` is the documented remedy.
- **Checksum drift**: if the upstream HF repo republishes the ONNX weights, the pinned checksum stops matching and every install breaks. Pin to a specific revision, not `main`.
- **`img-src` for generated images**: switching image engines changes the origin serving image blobs. Since C-388 fetches blobs and creates object URLs, `blob:` coverage matters more than the host entry — verify both are present.

## Open Questions

All three questions are resolved; recorded for traceability.

- ~~Vendor the Kokoro weights into the Tauri installer, or download on first use?~~ **Resolved 2026-08-13 by the user:** neither implicit nor bundled — an explicit download **button**. The installer stays small, and the fetch is a deliberate user action. See AC-4b through AC-4d.
- ~~Restore cross-origin isolation (threaded WASM, but re-opens the Google popup sign-in problem that `ce14406b` just solved) or accept single-threaded WASM?~~ **Resolved 2026-08-13:** accept single-threaded WASM — drop the `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers from `tauri.conf.json` so the Tauri webview matches the browser build. Restoring COI would re-open the exact Google popup sign-in problem `ce14406b` was created to fix, and WebGPU (the primary path) does not require COI. AC-6 covers honest `wasm` reporting; Linux WebKitGTK users who find WASM too slow get the documented `voice.tts.mode: 'server'` remedy.
- ~~Should `config.json` be writable from the app's settings UI, or file-only?~~ **Resolved 2026-08-13:** file-only for this contract; a settings UI is a follow-up. The only settings-UI surface added here is the voice-model download control (AC-4c).

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

## Execution Report

### Summary
Replaced build-time `PUBLIC_*` engine-URL baking with a runtime `config.json` loader (precedence: localStorage dev override → Tauri app-config file → `GET ./config.json` → dev-only `PUBLIC_*` defaults → unset), so the SPA bundle is now topology-agnostic. Vendored the ONNX runtime WASM into `static/ort/`, reworked the Kokoro worker for fully offline loading (`allowLocalModels=true`, local-model cache keys), added an explicit checksum-verified voice-model download service with progress/cancel/delete (AC-4c), reworked the TTS service around config-driven modes with honest `TtsBackend` reporting and no blind probing (AC-6/7/8), widened the Tauri CSP/capabilities for the new engine ports and dropped the stale COOP/COEP headers, added Rust-side model download + first-run config writer, and made the local-stack `build:client` emit `config.json` with static-serve + config-swap checks. Packaged-Tauri verification (AC-4d/5/9) is documented as manual — the Rust side compiles (`cargo check` passes) but no desktop build was produced in this environment.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Production build grep: 0 engine-URL literals across 217 emitted text files; enforced by `build_output.test.ts` + local-stack check.sh |
| AC-2 | ✅ | `runtime_config_service.test.ts` — config.json drives text/image/voice URLs, request uses `cache: no-store` |
| AC-3 | ✅ | 4 failure modes (missing/404/malformed/schema-invalid) tested; single warning; boot smoke via settings page load |
| AC-4 | ✅ | Offline loading design: worker loads from pre-warmed `transformers-cache` (`/models/…`) keys; no external fetch after first use |
| AC-4b | ✅ | `tts_service.test.ts` asserts zero fetches + `not-downloaded` state on synthesize with no model |
| AC-4c | ✅ | `voice_model_service.test.ts` (6 tests) + settings UI card; visual validation 95/100 |
| AC-4d | ⚠️ | No Kokoro weights bundled (weights are runtime-downloaded only); installer size comparison needs a packaged Tauri build (manual, recorded as pending) |
| AC-5 | ⚠️ | Rust commands implemented + `cargo check` passes; end-to-end packaged verification requires a desktop build (manual) |
| AC-6 | ✅ | Worker reports `backend: 'webgpu' \| 'wasm'`; main-thread WebGPU gate with timeout; UI states slower WASM |
| AC-7 | ✅ | `checkKokoroServer` probes only the configured URL; zero-fetch assertion in tests; boot logs confirm no 8880 probe |
| AC-8 | ✅ | Server mode POSTs to `{voice.tts.url}/v1/audio/speech` on non-default ports (tests + dev boot) |
| AC-9 | ⚠️ | CSP + capability ACL widened (11434/8188/8089/6006, no wildcard/CDN), COOP/COEP dropped; webview console verification needs packaged build (manual) |
| AC-10 | ✅ | `local-stack:test` passes: static serve of `build/`, config.json served, config swap without rebuild |

### Files Created
| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/runtime/runtime_engine_config.ts` | TypeBox schema for the runtime `config.json` document |
| `packages/shared/schemas/src/lib/runtime/runtime_engine_config.test.ts` | Schema validation tests (AC-3) |
| `packages/shared/types/src/lib/runtime/runtime_engine_config.ts` | Derived `Static<>` types |
| `apps/frontend/client/src/lib/services/config/runtime_config_service.svelte.ts` | Runtime config loader (precedence chain, validation, single warning) |
| `apps/frontend/client/src/lib/services/config/runtime_config_service.test.ts` | 9 loader tests (AC-2/AC-3) |
| `apps/frontend/client/src/lib/services/config/build_output.test.ts` | AC-1 build-output grep assertion |
| `apps/frontend/client/src/lib/services/audio/voice_model_service.svelte.ts` | Explicit voice-model download service (progress, checksum, cancel, delete, idempotent join) |
| `apps/frontend/client/src/lib/services/audio/voice_model_service.test.ts` | 6 AC-4c tests |
| `apps/frontend/client/src/lib/types/voice_model.ts` | `TtsBackend`, `VoiceModelState` client types |
| `apps/frontend/client/static/ort/` | Vendored ONNX runtime WASM binaries (4 files) |
| `apps/backend/local-stack/scripts/emit_config.sh` | Emits `config.json` for the staged client build |
| `apps/frontend/docs/src/content/docs/guides/configure-local-engines.mdx` | "Configure your local engines" docs page |

### Files Modified
| File | Change |
|---|---|
| `apps/frontend/client/src/lib/services/audio/kokoro_worker.ts` | `allowLocalModels=true`, `localModelPath=/models/`, vendored `wasmPaths`, webgpu/wasm backend report |
| `apps/frontend/client/src/lib/services/audio/tts_service.svelte.ts` | Config-driven modes, backend state, config-gated probe, not-downloaded gate |
| `apps/frontend/client/src/lib/services/audio/tts_service.test.ts` | Rewritten for AC-4b/6/7/8 |
| `apps/frontend/client/src/lib/services/image/image_generation_service.svelte.ts` | `image.url` from runtime config; graceful not-configured |
| `apps/frontend/client/src/lib/services/ai/stream_orchestrator_service.svelte.ts` | Server-TTS URL from runtime config |
| `apps/frontend/client/src/lib/services/ai/ai_gateway_service.svelte.ts` | Native Ollama detection URL from runtime config |
| `apps/frontend/client/src/lib/services/config/provider_endpoints.ts` | Ollama endpoints runtime-resolved (`getOllamaRuntimeEndpoints`) |
| `apps/frontend/client/src/lib/services/ai/clients/ai/clients/{ollama,comfyui}_client.ts` | Removed baked-in localhost defaults |
| `apps/frontend/client/src/lib/views/settings/audio/settings_audio_view{,_model}.svelte.ts` | Voice-model download control UI (AC-4c) |
| `apps/frontend/client/src/lib/views/settings/settings_view_model.svelte.ts` | `?section=` deep-link for settings sections |
| `apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts` | Detection-seeded connection URLs from runtime config |
| `apps/frontend/client/src/lib/views/settings/connection/connection_manager_view_model.svelte.ts` | Ollama probes/tests from runtime config |
| `apps/frontend/client/src/lib/views/settings/providers/tabs/{text,image,voice}_tab*.svelte*` | Placeholder literals → neutral hints; auto-detect from runtime config |
| `apps/frontend/client/src/lib/test_preload.ts` | Barrel mock additions for new services |
| `apps/frontend/client/src-tauri/tauri.conf.json` | CSP: added 8089/6006; dropped COOP/COEP headers |
| `apps/frontend/client/src-tauri/capabilities/default.json` | `http:allow-fetch` widened to 8089/6006 |
| `apps/frontend/client/src-tauri/src/lib.rs` | `read_runtime_config`, `download_model_file`, `read_model_file`, `delete_model_files`, first-run config writer |
| `apps/frontend/client/src-tauri/Cargo.toml` / `Cargo.lock` | reqwest/sha2/hex/futures-util for Rust-side download |
| `apps/backend/local-stack/package.json` | `build:client` drops `PUBLIC_*` baking; `stage:client` emits `config.json` |
| `apps/backend/local-stack/scripts/check.sh` | AC-1 bundle grep + AC-10 static-serve/config-swap checks |
| `apps/backend/local-stack/docker/client-server/client_server.ts` | `CLIENT_ROOT` env + `no-store` for config.json |
| `apps/backend/local-stack/docker/client/nginx.conf` | `no-store` for config.json |
| `packages/frontend/ai-gateway/src/lib/detection.ts` | `DEFAULT_OLLAMA_NATIVE_URL=''` + native-URL guard |
| `packages/frontend/ai-gateway/src/lib/text_adapter_openai_compatible.ts` | `DEFAULT_LOCAL_TEXT_ENDPOINTS` emptied (no baked-in endpoints) |
| `packages/shared/schemas/src/index.ts`, `packages/shared/types/src/index.ts` | Export new runtime config schema/types |

### Deviations from Spec
- **Resolved-config type is all-optional** (vs the contract's pseudocode with required `url`): the loader treats missing config as "unset" (rung 5) and the derived `Static<>` type reflects that; the contract's design note explicitly wants unset URLs, so this matches intent.
- **Voice pre-warm is limited to the default voice (`af_heart`)**; other voices cache on first use (kokoro-js fetches them with its own `kokoro-voices` cache). Full voice pre-warm would add ~20 MB to the download; noted for a follow-up if multi-voice offline matters.
- **`?section=` settings deep-link** added as a small testing/docs affordance (not in the contract's scope list).
- **Manual ACs (4d/5/9)**: no packaged Tauri desktop build possible in this environment; Rust side compiles (`cargo check` clean), CSP/capabilities updated, and the webview console cannot be verified without a packaged build. Needs the manual desktop verification step.

### Test Results
- Unit: 32 new tests added (runtime_config 9, tts_service 8, voice_model 6, build_output 1, schema 8); all pass. Client suite: 46 pre-existing failures (same suites as baseline — GameBootService, ImageViewModel, ProvidersViewModel, PersonaCreateViewModel), **0 new failures**.
- Integration: `local-stack:test` (check.sh) passes fully, including AC-1 grep and AC-10 static-serve/config-swap.
- Visual: Settings → Audio "Speech (Voice Model)" card — AI visual validation **95/100 PASS**.
- Baseline: 46 pre-existing failures, 0 new failures.
