# Distribution & Onboarding Strategy — 2026-08-19

> Working notes from a Windows local-stack bring-up session. Captures the
> reframe, the recommended ordering, and contract-ready seeds for the work
> that falls out of it. Nothing here is approved — it exists so contracts can
> be written from it.
>
> Companion to [`mvp-assessment-2026-08-16.md`](mvp-assessment-2026-08-16.md).

## 1. The reframe

We have been treating **web / Tauri / Docker** as three products. They are not.
There is **one app** and **three answers to "where does the LLM come from"**,
on two independent axes:

| | Browser | Desktop app |
|---|---|---|
| **BYOK cloud** | works today, zero install | works today, zero install |
| **Local engines** | blocked by CORS / COOP-COEP | native, no restrictions |

Docker does not appear in that table because **Docker delivers engines, not the
app**. Conflating the two is what makes the problem feel unsolvable.

Consequences that follow directly:

- The `client` Docker profile sits in the worst cell of the matrix — browser
  sandbox limits *and* Docker literacy required. Observed live: OPFS
  unavailable (no COOP/COEP) so the database falls back to
  IndexedDB-snapshotted, plus CORS failures on telemetry.
- **Web should be a demo surface, not a supported way to play.** BYOK-only,
  one click from marketing. The sandbox costs are structural, not bugs.
- **Desktop + auto-updater is the product.** Keep the updater: the two
  stale-image incidents below are exactly the failure class it prevents, and
  they reached a user (us) with no recovery path.

### Who we are already building for

The codebase has effectively already picked an audience:

- C-419 character card import → the SillyTavern / chub crowd, specifically.
- `openrouter` is the default connection provider, with a generic
  `openai-compat` option that already covers Ollama, LM Studio, KoboldCpp,
  and llama.cpp.
- Rust-side model downloader with checksum + origin validation already exists
  (`src-tauri/src/lib.rs`: `download_model_file`, `read_model_file`,
  `delete_model_files`, `configured_model_origin`,
  `validate_model_download_url`).
- Ollama detection is a first-class wizard option.

That audience overwhelmingly runs one-click local runners, **not**
`docker compose`. Very few will pull 13.6 GB through a compose file.

## 2. Recommended ordering

| # | Work | Why this order |
|---|---|---|
| 1 | BYOK onboarding polish | Costs nothing per user, serves the "install + autoupdate + bring a key" user directly, ~1 day |
| 2 | Release-trigger hygiene | Cheap, and it fixes the class of bug that ate a full session |
| 3 | Docker-free local install path | Serves the audience we already build for; removes our worst onboarding step |
| 4 | Managed trial (demo-scoped) | Only one that costs real money per user, forever — needs evidence it converts |

Keep Docker as the power-user path for the full text+image+voice+stt stack. It
is good at that. It stops being a liability the moment it is not the front door.

## 3. Open questions (answer before writing contracts 3 and 4)

- **OQ-1 — Does our content need uncensored models?** If personas and character
  cards drift adult, hosted models refuse and a managed trial looks broken to
  exactly the C-419 audience. This decides whether local is an enthusiast
  upgrade or the actual product. Note the image model we already ship is
  `circlestone-labs-non-commercial-license` (use-restricted), which also
  constrains any commercial tier.
- **OQ-2 — Are we ever willing to pay for inference?** A hosted tier collapses
  the onboarding problem and puts us on the hook for per-token cost. Desktop +
  BYOK is the right stepping stone either way.
- **OQ-3 — What is the actual BYOK drop-off?** Items 3 and 4 are both
  justified by "the key step loses users." That is currently an assumption.

---

# Contract-ready seeds

> ⚠️ **Provisional IDs.** `prepareDirectSource` allocates the next ID as
> `maxId + 1` from contract filenames on disk, so it does not know about IDs
> reserved here. Treat `C-42x` below as indicative only and re-check at
> authoring time — see the ID allocation caveat in
> [`../contracts/MVP_BACKLOG.md`](../contracts/MVP_BACKLOG.md).

## C-42x — Publish local-stack images on release, not by hand

| Field | Value |
|---|---|
| **Priority** | P1 — actively shipping broken images to users |
| **Target** | `.github/workflows/publish-local-stack.yml` |
| **Depends on** | — |
| **Docs impact** | internal |

### Problem & baseline evidence

`publish-local-stack.yml:30-36` is `workflow_dispatch:` only; the `push:`
trigger is commented out. Two images went stale in production as a result, and
both broke the clone-free installer path for every user:

| Image | Published | Fix landed | Gap |
|---|---|---|---|
| `aikami-model-fetcher` | 2026-08-15 01:26 UTC | `6d1c6b5c`, 2026-08-15 15:09 | ~14 h |
| `aikami-client` | 2026-08-15 12:20 UTC | `72d01838`, 2026-08-17 03:26 | ~39 h |

Symptoms were `Module not found "/app/stack/fetch_models.ts"` (fetcher) and
silently absent llama.cpp detection (client) — the shipped bundle contained
`Ollama reachable natively` but not `Local OpenAI-compatible server reachable`.

A content guard step now verifies the fetcher image carries its script and
manifest, but a guard that never runs cannot help.

### Acceptance gate

Given a merge to `main` touching `apps/backend/local-stack/**`, when CI runs,
then every `aikami-*` image is rebuilt and published, and the run fails if any
published image is missing files its Dockerfile claims to `COPY`.

### Notes

Consider whether every channel we support can actually be verified per
release. Channel count is the underlying risk: web hosting + 3 Tauri
platforms + 5 Docker images is already more than one person can eyeball.

---

## C-42x — BYOK onboarding: key to playing in 60 seconds

| Field | Value |
|---|---|
| **Priority** | P1 — highest impact per unit of effort in this document |
| **Target** | `apps/frontend/client/src/lib/views/capability/`, `.../settings/connection/` |
| **Depends on** | — |
| **Docs impact** | user-facing |

### Problem & baseline evidence

The user we are most worried about — "installs the app, wants an auto-updater,
fixes the LLM with BYOK" — is already served by the shipping desktop path.
Whether that flow is *good* has never been measured. It is the cheapest
possible intervention and it gates every other onboarding decision (OQ-3).

Existing surface: `openrouter` is the default provider in
`connection_manager_view_model.svelte.ts`; the capability screen already seeds
connections from detection results.

### Acceptance gate

Given a first-run desktop install with no providers configured, when the user
follows the guided path, then they reach a playable campaign in under 60
seconds with only an API key pasted — and drop-off at each step is
instrumented.

---

## C-42x — Docker-free local install path (engine sidecars)

| Field | Value |
|---|---|
| **Priority** | P2 — large; removes "install Docker Desktop" from onboarding |
| **Target** | `apps/frontend/client/src-tauri/`, `packages/shared/local-ai/`, `apps/backend/local-stack/stack/` |
| **Depends on** | OQ-1, OQ-3 |
| **Docs impact** | user-facing |

### Problem & baseline evidence

Local inference does not actually require Docker — Docker is only how we
currently *package* it. Most of the hard work is already done and is not
Docker-coupled:

- `packages/shared/local-ai/src/lib/recommend.ts` references docker **only in
  warning strings**; the hardware → VRAM tier → model planning logic is
  engine-agnostic.
- `src-tauri/src/lib.rs` already implements checksummed, origin-validated model
  download (`download_model_file`) plus read/delete.
- `models.manifest.json` + `fetch_models.ts` are the catalogue and fetch logic.
- **Voice needs no server at all**: `kokoro_worker.ts` runs Kokoro in-process
  via `kokoro-js` + `@huggingface/transformers` on WebGPU with a WASM
  fallback.

The missing piece is mostly: replace "emit a compose `.env`" with "fetch the
llama.cpp binary for this platform+backend and spawn it." Tauri's mechanism is
sidecars (`bundle.externalBin`), which is **not configured today** —
`tauri.conf.json` has neither `externalBin` nor `resources`.

### Risks — what Docker was doing for us

- Per-platform × per-backend engine binaries (CUDA / Vulkan / Metal / CPU).
  Docker was our ABI isolation.
- Process lifecycle: start, stop, crash recovery, port conflicts, orphan
  cleanup on hard quit.
- GPU driver variance on bare metal is messier than in a container.
- AV / SmartScreen dislike an unsigned downloaded exe spawning another exe.

### Explicit non-goal

**Do not ship models inside the installer.** A 7.5 GB installer that must be
rebuilt and re-signed per model update is bad for us and for metered
connections. Download on first run — resumable and checksummed, which already
exists — and let the wizard size the download to the actual machine.

### Acceptance gate

Given a Windows machine with a supported GPU and no Docker installed, when the
user runs the installer and selects local inference, then the wizard detects
hardware, downloads a correctly-tiered model set, spawns the engine as a
sidecar, and the app reports text as detected — with the auto-updater intact.

---

## C-42x — Managed trial tier (demo-scoped)

| Field | Value |
|---|---|
| **Priority** | P3 — only item with a permanent per-user cost |
| **Target** | new service; `apps/backend/` |
| **Depends on** | OQ-1, OQ-2, OQ-3 |
| **Docs impact** | user-facing |

### Problem & baseline evidence

The hard gate is C-323: no text provider, no play. A managed trial removes it
for everyone, at our cost.

**Do not build this on OpenRouter `:free` models.** They are rate-limited,
rotated and deprecated without notice, usually heavily quantized, and most log
prompts for training — an onboarding experience that changes under us with no
warning. Their ToS also warrants a close read before proxying free capacity to
our own users. Pick one cheap *paid* model we control instead.

**Do not clone `nordclaw/apps/backend/edge-proxy` wholesale.** It is ~10k lines
built for a B2B compliance product: OIDC service auth, a streaming PII
redaction pipeline (vault / stitcher / prefilter / window), org credit ledgers
with a 1.30× margin, Pub/Sub audit settlement, category routing, managed Vertex
tiers. Aikami has no orgs, no PII obligations, and no billing.

Directly liftable from it:

- `credit_enforcement.rs::extract_token_usage` — parsing usage out of both
  JSON bodies and SSE final chunks is fiddly and already solved.
- The provider-registry indirection, so swapping upstream models is config.
- The Cloud Run + GSM + Moon deployment shape.

Note its `rate_limiter.rs` is **in-memory per Cloud Run instance** ("effective
global limit is RPM × instances") — acceptable for keyed B2B traffic, not for
bounding spend on a public trial.

### Cost warning

A text RPG is close to the worst possible free-tier cost profile: long context
that grows with campaign length, multi-turn, streaming, plus worldgen. One
engaged trial player can outspend a hundred casual chat users. Scope this as a
**demo, not a free tier** — "play the intro campaign, then connect a key or run
locally" — so the cap is a product boundary rather than a disappointment.

### Acceptance gate

Given an authenticated account (Firebase Auth — no anonymous access, or it will
be scripted and drained), when it exceeds its token budget, then requests are
refused with a clear upgrade path; and given the global monthly spend cap is
reached, then the service fails closed.

---

## C-42x — Portable install layout (optional, pairs with the Docker-free path)

| Field | Value |
|---|---|
| **Priority** | P3 |
| **Target** | `apps/frontend/client/src-tauri/src/lib.rs`, capability allow-list |
| **Depends on** | — |
| **Docs impact** | user-facing |

### Problem & baseline evidence

Saves, maps, assets, config, and the SQLite file currently live under
`app_data_dir()` (`lib.rs:25-29`, `ASSETS_SUBDIR = "aikami-assets"`) — i.e.
`%APPDATA%\com.aikami.app\aikami-assets\`. A portable layout puts them under
the install path the wizard already asks about: delete the folder to uninstall,
no registry, nothing scattered.

Single well-contained resolution point, so the change is small. The fs
capability allow-list is pinned to `$APPDATA/aikami-assets/**` and would need
widening — worth reviewing deliberately rather than just loosening. Multi-user
installs under `Program Files` need a per-user fallback.

---

# Smaller items found in the same session

## Image engine detection probe budget is too tight

`image_engine_factory.svelte.ts:25-28` gives each engine a 250 ms probe with a
450 ms total budget. On a cold page load sd-server answers slower than that, so
detection fails and the user must click retry; afterwards everything is warm
and it succeeds instantly. Failed detection is *not* negatively cached (the
guard is `if (_detectionCache)`, and `undefined` is falsy), so each attempt
genuinely re-probes — raising the two constants is the fix.

## Seeded image connection is mislabelled

`capability_view_model.svelte.ts` seeds `provider: 'comfyui'` for any detected
image engine, so an sd-server install shows "ComfyUI (local)". Left as-is
deliberately: the connections screen only classifies `comfyui` / `webui` /
`openai-compat` (`connection_manager_view_model.svelte.ts:192`), so writing
`sdcpp` would produce a connection it cannot render. Generation is unaffected —
it dispatches through `resolveImageEngine()`, not the label. Fixing it properly
means teaching the connections UI about sd-server.

## `emit_config.sh` hardcodes a model name that is not what runs

It emits `"model": "qwen3-4b-instruct"` while the stack actually loads whatever
the wizard planned (observed: `mistral-nemo-instruct-2407-q4_k_m`).
llama-server serves its loaded model regardless of the requested id, so this
appears inert — but the value is simply wrong.

## Demote the `client` Docker profile

Its real niche is headless / LAN / remote play. It should not be presented as a
peer of the desktop app in the wizard, given it is strictly worse than either
neighbour in the matrix in §1.
