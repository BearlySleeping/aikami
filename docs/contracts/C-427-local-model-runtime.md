---
id: C-427
title: "Local Model Runtime — generalize the Kokoro binding into a modality-agnostic local-model layer, and add a small local LLM for parallel micro-tasks"
source: "Investigation 2026-08-23 — evaluation of Cactus-Compute/needle2 for agent micro-tasks"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
  pr_number: null
created_at: "2026-08-23"
---

# Contract C-427: Local Model Runtime

## Metadata

| Field | Value |
|---|---|
| **Source** | Request to bind `Cactus-Compute/needle2` the same way Kokoro is bound, and run agent micro-tasks (expression, image prompt, relationship, battle trigger) on it in parallel with chat. Benchmarking rejected needle2; the plumbing request stands and generalizes. |
| **Target** | `apps/frontend/client/src/lib/services/audio/voice_model_service.svelte.ts` (452 lines, Kokoro-specific); `apps/frontend/client/src/lib/services/agent/agents/*.ts` |
| **Priority** | P2 — infrastructure. Enables offline agent micro-tasks and removes the copy-paste tax on the second in-webview model. |
| **Dependencies** | C-389 (voice model download), C-320 (AI gateway), C-236 (agent pipeline) |
| **Status** | draft |
| **Promotion** | `integrated` |
| **Docs Impact** | internal |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

Two separate problems, one contract.

### Problem 1 — the Kokoro binding is a one-off

`voice_model_service.svelte.ts` is 452 lines. Roughly 400 of them are
model-agnostic: pinned manifest → download (browser `fetch` or Tauri
`invoke`) → SHA-256 + size verify → Cache Storage write → status/delete.
Only the `MODEL_ID` / `VOICE_REPO` constants and the two cache-key helpers
are Kokoro-specific.

Adding any second in-webview model — a text LLM, Whisper for STT, a local
reranker — means copy-pasting those 400 lines. The Rust side
(`src-tauri/src/lib.rs:119` `download_model_file`) is **already generic**:
it takes `url`, `checksum`, `file_name`, `expected_size` and validates
against the configured model origin. The JS side is the only thing that
hardcodes a model.

### Problem 2 — needle2 does not work for these tasks

`Cactus-Compute/needle2` was evaluated as the micro-task engine. It ships a
`wasm/` folder the GitHub README does not document: `needle.js` (62 KB
emscripten UMD factory), `needle.wasm` (333 KB), plus `needle2.cact`
(13.7 MB weights). The C API is four functions:

```c
int  needle_load(const unsigned char* cact, unsigned long long n);
int  needle_init(const char* system_prompt, const char* tools_json, const char* tool_index_path);
int  needle_complete(const char* input, int max_new_tokens, char* out, int out_capacity);
void needle_reset(void);
```

It was run under Bun (`createNeedle({ wasmBinary })`). Engine boots in 11 ms,
weights load in 26 ms, session init ~650 ms. The README's canonical example
reproduces perfectly:

```
"dim the living room to 30"  →  set_lights{room:"living room", on:true, brightness:30}   conf 0.92
```

On our tasks it is **confidently wrong**. Single tool declared,
`needle_reset()` per turn, hand-tuned enum descriptions:

| Input | Output | Confidence |
|---|---|---|
| `The bandit snarled and drew his blade at Kael.` | Kael is `happy` | 0.98 |
| `Kael stared at the map, brow furrowed…` | `happy` | 0.84 |
| `A pack of wolves circles the camp, growling.` | `start_battle{enemy:"camp"}` | 1.00 |
| `The bandit drew his blade and lunged at you.` | `start_battle{enemy:"BandDrewHealth"}` | 1.00 |
| `Elara smiled and thanked you for saving her brother.` | `[]` (refused) | 0.97 |

The cause is structural, not prompt tuning. Needle fills argument slots from
**literal spans present in the input** — its own README states "Arguments
contain only values evidenced by the input." Our micro-tasks are the inverse:
they require inference over prose ("cheeks going pink" → blushing, "snarled"
→ angry). Nothing in the text literally names the emotion.

The confidence head does not rescue it. Its contract is "act above threshold,
escalate below" — but it reported 0.84–1.00 on every wrong answer above. Even
on imperative input, declaring 4 tools degraded it:
`"attack the bandit with my sword"` → `attack{target:"sword", weapon:"bandit"}`.

**needle2 is rejected for this contract.** Recorded here so it is not
re-litigated.

- **Reproduction**: `wc -l apps/frontend/client/src/lib/services/audio/voice_model_service.svelte.ts`
- **Baseline tests**: `voice_model_service.test.ts`, `expression_agent.test.ts`,
  `agent_pipeline.test.ts`. Green before starting and after every step.

## Model Evaluation

Three candidates were benchmarked on the real tasks via `@huggingface/transformers`
v4.2.0 (already a client dependency), greedy decoding, CPU/WASM.

| Model | Size (q4f16) | Expression | Battle | Relationship | Verdict |
|---|---|---|---|---|---|
| `Cactus-Compute/needle2` | 13.7 MB | 0/3 | 1/3 | 0/2 | **Rejected** — slot-filler, not a classifier |
| `onnx-community/LFM2-350M-ONNX` | 255 MB | 0/3 | 1/3 | 0/2 | **Rejected** — ignored the JSON contract, replied in prose |
| `onnx-community/Qwen3-0.6B-ONNX` | 570 MB | **3/3** | **3/3** | 0/2 structural | **Recommended** |

Qwen3-0.6B with a one-shot example in the system prompt:

```
"Kael stared at the map, brow furrowed…"        → {"name":"Kael","expression":"thoughtful"}   ✓
"The bandit snarled and drew his blade at Kael" → {"name":"bandit","expression":"angry"}      ✓
"Elara laughed, cheeks going pink…"             → {"name":"Elara","expression":"happy"}       ✓
"The bandit drew his blade and lunged at you."  → {"battle":true,"enemy":"bandit"}            ✓
"You sit by the fire and share a quiet meal."   → {"battle":false,"enemy":""}                 ✓
"A pack of wolves circles the camp, growling."  → {"battle":true,"enemy":"Wolves"}            ✓
```

Latency 0.6–1.3 s on CPU/WASM with `/no_think` appended to suppress Qwen3's
reasoning mode. WebGPU is the same path Kokoro already proved.

The relationship failures are the load-bearing finding: outputs were
`"warmmer"` (invalid enum), `{"changes":[…]"}` (malformed brace), and one
genuine semantic miss. **Two of three are structurally impossible under
schema validation with a repair retry.** Free-form JSON is not reliable at
0.6B — the runtime layer must own validate-and-repair, not each caller.

### Recommendation

**`onnx-community/Qwen3-0.6B-ONNX`**, dtype `q4f16`, revision pinned to
`da1453100cf3ff33ef56d17983fc7a8648706db6`.

Chosen because it reuses the exact stack Kokoro already cleared: transformers.js
+ onnxruntime-web, WebGPU with WASM fallback, Cache Storage under
`env.localModelPath`, vendored ORT binaries, no CSP change. Total download
579 MB (570 MB weights + 9 MB tokenizer).

`onnx-community/gemma-3-270m-it-ONNX` q4f16 (273 MB) is registered as a
low-RAM tier but **is not yet benchmarked** — do not ship it as a default
until it passes AC-5.

## User Outcome

A player on a machine with no local LLM server gets working expressions,
battle triggers and relationship tracking while chatting against a cloud
model — the micro-tasks stop consuming cloud tokens and stop adding latency
to the reply they annotate. A developer adding the next local model writes a
bundle declaration, not a download service.

## Success Measures

- **Time/latency target**: a micro-task completes in < 2 s p50 on WebGPU and
  never blocks the main chat stream. Pipeline budget in
  `agent_pipeline_service.svelte.ts` is currently 500 ms and must be raised
  per-agent for local tasks (see AC-4).
- **Offline/degraded behavior**: model not downloaded → agents fall back to
  the existing gateway path, unchanged. This is the current behaviour, so
  "not downloaded" is never a regression.
- **Code measure**: `voice_model_service.svelte.ts` drops below 120 lines,
  keeping only the Kokoro bundle declaration and its two cache-key helpers.

## Existing System & Reuse Map

| Need | Reuse | Do not rebuild |
|---|---|---|
| Rust download + checksum + origin validation | `src-tauri/src/lib.rs:119` `download_model_file` | Already generic — **zero Rust changes** |
| Progress events | `model-download-progress` Tauri event | — |
| JSON extraction from LLM prose | `sanitizeJsonResponse` in `packages/frontend/ai-gateway/src/lib/structured.ts:99` — already strips ` ```json ` fences and brace-matches | — |
| Schema validation | `validateAgainstSchema`, `enforceStrictSchema` (same file) | — |
| Provider routing | `createAdapterRegistry` / `AiTextAdapter` (C-320) | — |
| Hardware tiering | `@aikami/local-ai` `TIER_TABLE`, `recommend.ts` (C-391) | — |
| Model state type | `VoiceModelState` in `@aikami/types` — generalize to `LocalModelState` | — |

## Architecture Directives

Four layers. Each is independently testable and none knows about the ones above it.

### Layer 1 — `ModelAssetStore` (asset lifecycle, modality-agnostic)

New package `packages/frontend/local-runtime/`. Lifts `voice_model_service`
wholesale; the only new concept is that a bundle is data, not code.

```ts
export type LocalModelAsset = {
  /** Path inside the HF repo. */
  path: string;
  bytes: number;
  sha256: string;
  /** Cache Storage bucket this asset lands in. */
  cache: string;
  /** Cache key the consuming engine resolves. */
  key: string;
};

export type LocalModelBundle = {
  id: string;               // 'kokoro-82m' | 'qwen3-0.6b'
  repo: string;             // HF repo id
  revision: string;         // pinned commit — never 'main'
  label: string;
  license: string;
  modality: 'text' | 'voice' | 'stt' | 'image';
  assets: readonly LocalModelAsset[];
  manifestKey: string;
  manifestVersion: number;
};

export type ModelAssetStore = {
  readonly states: Readonly<Record<string, LocalModelState>>;
  totalBytes(bundleId: string): number;
  status(bundleId: string): Promise<LocalModelState>;
  download(bundleId: string): Promise<LocalModelState>;  // idempotent join
  cancel(bundleId: string): void;
  remove(bundleId: string): Promise<void>;
};
```

Two transports behind one interface, selected by `isTauriRuntime()`:
`BrowserAssetTransport` (streaming `fetch`, size-capped mid-stream) and
`TauriAssetTransport` (`invoke('download_model_file')` then `read_model_file`).
Both converge on the same verify → `caches.put` path, exactly as today.

**Directive**: preserve every C-389 CR hardening — size enforced while
streaming, checksum before cache write, manifest versioning, abort between
files on the Tauri path, listener registered before `invoke`. This is a
refactor, not a rewrite; behaviour is the acceptance bar.

### Layer 2 — `LocalEngine` (worker-backed inference)

```ts
export type LocalEngine<TIn, TOut> = {
  readonly id: string;
  readonly bundleId: string;
  readonly status: LocalEngineStatus;   // uninitialized | initializing | ready | error | not-downloaded
  readonly backend: 'webgpu' | 'wasm';
  init(): Promise<void>;
  run(input: TIn, options?: { signal?: AbortSignal }): Promise<TOut>;
  dispose(): void;
};
```

Implementations are the worker wrappers. `kokoro_worker.ts` becomes
`voiceEngine` behind this interface with no change to its internals. New
`text_llm_worker.ts` wraps transformers.js `pipeline('text-generation', …)`
with the same `initialize` / `run` postMessage protocol and the same
`hasWebGpu()` probe already in `kokoro_worker.ts:88`.

**Directive**: engines never fetch. They read from Cache Storage that Layer 1
pre-warmed. `env.allowLocalModels = true` and `env.localModelPath = '/models/'`
stay as-is, so the text model loads offline on the same keys.

### Layer 3 — `LocalTaskPool` (the micro-task surface)

```ts
export type LocalTask<T> = {
  id: string;
  schema: TSchema;                            // TypeBox, from @aikami/schemas
  systemPrompt: string;
  examples?: ReadonlyArray<{ input: string; output: T }>;
  maxNewTokens: number;
  repairAttempts: number;                     // default 1
  timeoutMs: number;
};

localTaskPool.run({ task: 'expression', input: aiResponse, signal });
```

The pool owns: a priority queue, per-task timeout and abort, and the
validate → repair → give-up loop using `sanitizeJsonResponse` +
`validateAgainstSchema`. A task that fails validation twice returns
`{ ok: false }` and the caller falls back to the gateway.

**Directive on "parallel"** — be precise about what is being bought. A WASM
or WebGPU session serializes; two micro-tasks do not truly overlap on one
engine, and each additional worker holds its own ~570 MB copy of the weights.
The real win is that micro-tasks run **concurrently with the main chat
stream**, which goes to the cloud provider. Default pool size is therefore
**1**, hard cap 2 (WebGPU only, opt-in). Do not size the pool to the task
count.

### Layer 4 — gateway integration

Register the text engine as an `offline`-mode `AiTextAdapter` via
`registry.registerText({ mode: 'offline', adapter })`, so
`aiGatewayService.generateText({ schema })` routes to it with no caller
change. Agents that want the fast path unconditionally call `localTaskPool`
directly.

## State & Data Models

`VoiceModelState` in `@aikami/types` is renamed `LocalModelState` and gains a
`bundleId`. A type alias keeps `VoiceModelState` compiling through the
migration. Bundle declarations live in
`packages/shared/constants/src/lib/local_models.ts`; task declarations in
`packages/shared/schemas/src/lib/local_ai/tasks.ts` — per the monorepo
boundary rule, never in `apps/**`.

## Quality Requirements

- Checksums are generated, not hand-typed. Add
  `scripts/src/lib/ops/gen_model_bundle.ts` that takes a repo + revision +
  file list, downloads, hashes, and prints the `LocalModelBundle` literal.
  The current Kokoro manifest is hand-maintained and that does not scale to
  five files across two caches.
- Every engine worker must report the backend it actually loaded, as
  `kokoro_worker.ts` already does — honest degraded state, not assumed WebGPU.
- Pinned revisions only. A `main` revision in a bundle declaration fails review.
- License recorded per bundle. Qwen3 is Apache-2.0; needle2 is Apache-2.0.

## Migration & Rollback

Layer 1 lands first as a pure refactor with `voice_model_service` delegating
to it — Kokoro keeps working or the step is reverted. The text model is
additive and gated on explicit download, so rollback is deleting the bundle
declaration and the agent opt-in flag.

## Scope Boundaries

**In scope**: the four layers, the Qwen3 bundle, wiring expression / battle /
relationship / image-prompt agents to the pool with gateway fallback.

**Out of scope**: replacing the native local stack (C-390/C-391 sd-server and
llama.cpp subprocesses) — this contract is the *in-webview* path only.
Grammar-constrained decoding (web-llm / XGrammar) is deliberately deferred;
revisit only if AC-5 shows repair-retry rates above 30%. STT and image
engines are named in the interfaces but not implemented.

## Acceptance Criteria

### AC-1: Kokoro rides the generic store with zero behaviour change
`voice_model_service.svelte.ts` is under 120 lines and contains only the
Kokoro `LocalModelBundle` plus its cache-key helpers. `voice_model_service.test.ts`
passes unmodified. Download, cancel, delete, and the Tauri path all behave
as before, including a mid-download cancel and a checksum-mismatch abort.

### AC-2: A second bundle needs no new download code
Adding the Qwen3 bundle touches only `local_models.ts`. No file under
`services/` gains download, hashing, or Cache Storage logic.

### AC-3: Text engine loads offline on both backends
After an explicit download, the text worker initializes with the network
disabled, on WebGPU where available and WASM otherwise, and reports which one
it used. Verified in the Tauri build with no CSP change.

### AC-4: Micro-tasks run concurrently with the main stream
Expression, battle-trigger and relationship agents call `localTaskPool` when
the bundle is ready and fall back to the gateway when it is not. The main
chat stream's time-to-first-token is unchanged within noise while a
micro-task is in flight. Per-agent timeout is configurable and defaults to
2000 ms for local tasks — the current global 500 ms is not survivable for a
0.6B model and must not be applied to them.

### AC-5: Measured accuracy gate
A fixture suite of at least 20 hand-labelled prose samples per task runs
against the pool. Expression and battle-trigger must reach ≥ 80% exact match;
relationship must reach ≥ 70%. Repair-retry rate is recorded. **A task below
its bar ships disabled**, not degraded — a confidently wrong expression is
worse than no expression, which is the entire lesson of the needle2
evaluation.

### AC-6: Bundle checksums are generated
`gen_model_bundle.ts` exists and reproduces both the Kokoro and Qwen3 bundle
literals byte-for-byte from repo + revision + file list.

## Implementation Sequence

1. Layer 1 `ModelAssetStore` + `gen_model_bundle.ts`; Kokoro delegates to it (AC-1, AC-2, AC-6).
2. Layer 2 `LocalEngine`; wrap the existing Kokoro worker, no behaviour change.
3. `text_llm_worker.ts` + Qwen3 bundle + settings download control (AC-3).
4. Layer 3 `LocalTaskPool` with validate/repair; task declarations (AC-4).
5. Fixture suite and the accuracy gate; enable tasks that pass (AC-5).
6. Layer 4 gateway adapter registration.

Steps 1–2 are shippable alone and are worth landing even if the text model is
later swapped — they are the part of the original request that survives the
model verdict.

## Edge Cases & Gotchas

- **Qwen3 emits ` ```json ` fences.** `sanitizeJsonResponse` already handles
  this; do not add a second stripper.
- **Qwen3 is a reasoning model.** Append `/no_think` to the user turn or it
  spends its token budget in `<think>` blocks. Strip any `<think>…</think>`
  defensively.
- **transformers.js resolves `.onnx_data` siblings.** Qwen3-0.6B q4f16 is a
  single file, but gemma-3-270m and LFM2 split weights into `model_q4f16.onnx`
  + `model_q4f16.onnx_data`. A bundle for those must list both, or loading
  silently falls back to the network.
- **Memory.** Each pool worker holds its own copy of the weights. Two WebGPU
  workers is ~1.2 GB. Gate pool size 2 behind a hardware check using the
  existing `@aikami/local-ai` detection.
- **`needle_complete` is conversational.** Irrelevant now that needle2 is
  rejected, but recorded: consecutive calls continue one conversation and
  leak state across turns. `needle_reset()` is required per independent
  classification, and skipping it was what produced the first round of
  garbage results.
- The 570 MB download is 6× Kokoro's 92 MB. The settings UI must show the
  size before the user commits, as C-389 AC-4b already requires.

## Open Questions

1. Should the Qwen3 download be offered on the mobile/Tauri-Android target at
   all, or desktop-only? 570 MB plus ~700 MB runtime is aggressive on a phone.
2. Is the image-prompt agent better served by the local model or left on the
   cloud path? It generates prose, not labels, so the accuracy argument here
   does not transfer — it needs its own evaluation before being added to AC-5.
3. If AC-5 fails for relationship tracking even with repair retries, does that
   task move to grammar-constrained decoding (web-llm, a second runtime) or
   stay on the gateway?

## Amendments

None.
