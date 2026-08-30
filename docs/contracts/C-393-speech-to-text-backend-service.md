---
id: C-393
title: "Speech-to-Text Backend Service (sherpa-onnx streaming + whisper.cpp batch)"
source: "user request — 'also setup contract for speech to text setup (for backend)'"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-13"
---

# Contract C-393: Speech-to-Text Backend Service (sherpa-onnx streaming + whisper.cpp batch)

## Metadata

| Field | Value |
|---|---|
| **Source** | Local-stack engine review, 2026-08-13. C-390 provisions an `stt` compose profile and port but leaves the service itself undefined. This contract makes it real: engine choice, wire protocol, models, and the API surface C-359 will consume. |
| **Target** | `apps/backend/local-stack/docker/voice/`, `compose.yaml` (healthcheck + profile wiring), `.env.example` (STT-off default), `bin/run-native-stt.sh`, `stack/models.manifest.json`, `packages/shared/{schemas,types}/` |
| **Priority** | P2 — no consumer exists until C-359 (Speech Input and Hands-Free Play). Land it before that work starts, not before. |
| **Dependencies** | C-390 (compose topology, `stt` profile, port constant, model manifest and fetcher). C-389 reserves `voice.stt.url` in the runtime client config. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | user-facing → the voice section of "Run Aikami locally"; internal → the STT API contract that C-359 codes against |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Nothing in the client consumes STT today.** A search across `apps/frontend/client/src` and `packages/frontend` for `whisper`, `SpeechRecognition`, `transcrib`, and `moonshine` returns only unrelated matches (export formatters, test fixtures). C-359 is the intended consumer and is still `not_started`. This is greenfield, and the API surface is therefore free to be designed rather than retrofitted.

- **The infrastructure is half-present but undefined.** `apps/backend/local-stack/docker/voice/entrypoint.sh` already supports `ENABLE_STT` (default `false` in `compose.yaml`), and the README documents a Moonshine tiny int8 model in `models/stt/` with a websocket server on `8087`. But the compose healthcheck probes only the TTS port, the manifest holds just the tiny Moonshine entry (no whisper.cpp, no tier variants), and there is no documented protocol, no language handling, no VAD, and no smoke test. It is a placeholder, not a service.

- **C-390 provisions the slot without filling it.** It adds an `stt` compose profile, an `stt` port constant, and the model-store plumbing. It explicitly leaves the engine and API definition out of scope.

- **The two candidate engines solve different problems, and picking one is wrong.**
  - **sherpa-onnx / Moonshine** (MIT) — websocket transport, tiny, shares the sherpa-onnx runtime already used for TTS, can produce partial hypotheses via incremental decode of the audio-so-far. Right for push-to-talk and hands-free.
  - **whisper.cpp** (MIT, ggml) — batch, OpenAI-compatible `POST /v1/audio/transcriptions`, better accuracy, wide language coverage. Right for transcribing a recorded clip or an imported audio file.

  A hands-free RPG needs the first; anything file-based needs the second.

- **CrisperWhisper is disqualified on licensing, not quality.** Its inference code is MIT but **the model weights carry the Nyra Health Non-Commercial Research License** — commercial use requires a separate licence. It also requires CTranslate2 (NVIDIA + Linux) or PyTorch, with no GGML/ONNX export and no server. Its genuine advantage is verbatim transcription with fillers and precise word-level timestamps through disfluencies. This contract must leave a seam for it as a licensed advanced provider without shipping it.

- **Existing implementation to reuse**: `docker/voice/Dockerfile.sherpa` (working C++ container with non-root `VOICE_UID`/`VOICE_GID`), `entrypoint.sh` (model auto-download + process supervision, already `ENABLE_STT`-aware), `bin/run-native-stt.sh` (the no-Docker path, which is the **only** path on macOS), and C-390's manifest fetcher.

- **Known gaps**: no protocol spec, no VAD, no language selection, no health check, no model tiers, no smoke test, no engine abstraction.

- **Baseline tests**: `bun moon run local-stack:test` green, and the `voice` profile healthy per C-390 AC-4.

## User Outcome

After this contract, a **developer building C-359** can send microphone audio
to a documented local endpoint and receive streaming partial transcripts and a
final result — with no cloud service, no API key, and no Python.

## Success Measures

- **Time/latency target**: for streaming, first partial hypothesis within 300 ms of speech onset and final result within 500 ms of endpoint detection, on CPU. For batch, faster than realtime (RTF < 1.0) on CPU for the default model.
- **Offline/degraded behavior**: fully offline once the model is fetched. With the STT profile disabled or the model absent, the service is simply not present — `voice.stt.url` stays unset and C-359's consumer degrades to text input.
- **Production journey enabled**: unblocks C-359, the accessibility contract, which is the reason STT exists in this project at all.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| C++ voice container | `docker/voice/Dockerfile.sherpa` | reuse — STT is the same binary |
| Model download + supervision | `docker/voice/entrypoint.sh` (`ENABLE_STT`) | modify — manifest-driven, health-aware |
| Native STT launcher | `bin/run-native-stt.sh` | reuse — the macOS path |
| Model manifest + fetcher | C-390 `stack/models.manifest.json`, `fetch_models.ts` | reuse — add STT entries |
| Compose profile + port | C-390 `stt` profile and port constant | reuse |
| Runtime client config slot | C-389 `voice.stt.url` | reuse |
| Non-root container posture | `VOICE_UID` / `VOICE_GID` pattern | reuse |
| Compose health check | `compose.yaml` voice healthcheck (TTS port only) | modify — cover the STT endpoint too (Watch Points) |
| Shipped default config | `.env.example` (`COMPOSE_PROFILES` lists `stt`, `ENABLE_STT=true`) | modify — STT must be opt-in; AC-7 must hold against the shipped defaults |

## Overview

Define the STT service as a two-protocol surface on the existing sherpa
container — a streaming websocket for live speech and an OpenAI-compatible
batch endpoint for recorded audio — backed by Moonshine for streaming and
whisper.cpp for batch, with Silero VAD for endpointing, manifest-driven model
tiers, health checks, and a documented wire contract that C-359 codes against.

## Design Reference

**Two protocols, one service, because they are genuinely different jobs:**

| Protocol | Endpoint | Engine | Use case |
|---|---|---|---|
| Streaming | `WS {stt}/v1/stream` | sherpa-onnx Moonshine | Push-to-talk, hands-free play; partial hypotheses while speaking |
| Batch | `POST {stt}/v1/audio/transcriptions` | whisper.cpp | Recorded clips, imported audio; OpenAI-compatible so any tool works |

The batch endpoint deliberately mirrors OpenAI's shape (`multipart/form-data`
with `file`, `model`, `language`, `response_format`) so that swapping in a
cloud provider, or pointing a third-party tool at it, needs no adapter. The
streaming protocol has no cross-vendor standard, so it is ours to define —
which makes documenting it precisely part of the deliverable.

**VAD is not optional for the streaming path.** Without endpoint detection the
client must guess when the user stopped speaking, which is the difference
between hands-free play working and being infuriating. sherpa-onnx bundles
Silero VAD (MIT); it runs server-side so every client gets identical
behaviour.

**Model tiers**, added to C-390's manifest. Exact sizes and SHA-256 digests are
resolved at implementation from pinned revisions:

| Tier | Streaming | Batch | Licence |
|---|---|---|---|
| minimal | Moonshine tiny int8 | whisper.cpp `ggml-tiny` | MIT |
| default | Moonshine base int8 | whisper.cpp `ggml-base` | MIT |
| accuracy | Moonshine base | whisper.cpp `ggml-small` | MIT |

Moonshine is English-only. Multilingual users must fall back to whisper.cpp,
which covers ~99 languages — this is a real functional split and the service
must report it rather than silently transcribing English badly.

**Seam for licensed providers.** The engine behind each protocol is selected
by env var (`STT_STREAM_ENGINE`, `STT_BATCH_ENGINE`). A future
CrisperWhisper provider — for verbatim transcription with word-level
timestamps, under a commercial licence the user supplies — becomes a new value
plus a container, not a redesign.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Reuse the sherpa container; do not add a third voice image.** Streaming
  STT and TTS share the container and the model store. whisper.cpp is a
  separate process and may be a separate container behind the same profile,
  but must not duplicate the model volume.
- **The streaming endpoint is a new server, not the bundled binary.** The
  shipped `sherpa-onnx-offline-websocket-server` speaks its own
  config/`done`/`final_result` protocol, emits no partial hypotheses for
  offline Moonshine, and has no VAD events — it cannot satisfy AC-1/AC-2.
  The streaming endpoint is a small custom server in the voice container
  (same stdlib pattern as `tts_server.py`) wrapping sherpa-onnx's
  `OfflineRecognizer` (Moonshine) plus Silero VAD, supervised by the
  existing `entrypoint.sh`. Only then is the protocol defined in this
  contract the protocol actually on the wire.
- **Ship no weights in any image.** STT models come from C-390's manifest
  fetcher into the shared volume, like every other model.
- **The batch endpoint must be OpenAI-shaped**, accepting `multipart/form-data`
  with `file`, and optional `model`, `language`, and `response_format`. Deviating
  costs the interoperability that is the entire reason to pick that shape.
- **Define the streaming protocol explicitly and version it.** Message types,
  audio encoding, sample rate, chunk size, and every server event are part of
  this contract, not implementation detail. C-359 depends on the shape.
- **Audio format is fixed and documented**: 16 kHz mono 16-bit PCM. Resampling
  is the client's job — doing it server-side hides format bugs and burns CPU
  in the hot path.
- **VAD runs server-side** and emits explicit speech-start and speech-end
  events. The client must never have to infer endpointing from silence.
- **The service reports its own capabilities.** `GET {stt}/v1/capabilities`
  returns engines, loaded models, supported languages, and whether streaming
  is available — so C-359 can adapt instead of probing by failing.
- **Never enable STT by default.** A microphone-adjacent service that starts
  unasked is a privacy problem. It stays behind the opt-in `stt` profile, and
  the README must say what it does and does not do with audio.
- **Audio is never persisted.** Buffers are transient and freed after
  transcription. No debug audio dump, not even behind a flag, without an
  explicit separate opt-in env var that is off in every shipped configuration.
- **macOS runs STT natively**, via `bin/run-native-stt.sh`, for the same reason
  as every other engine — Docker Desktop has no GPU passthrough and this is a
  latency-sensitive path.

## State & Data Models

```ts
/** Which engine serves each protocol. Env-selected; extensible for licensed providers. */
type SttStreamEngine = 'moonshine';           // future: 'crisperwhisper'
type SttBatchEngine = 'whisper-cpp';          // future: 'crisperwhisper'

/** GET /v1/capabilities */
type SttCapabilities = {
  readonly streaming: {
    readonly available: boolean;
    readonly engine: SttStreamEngine;
    readonly model: string;
    /** Moonshine is English-only; whisper covers ~99 languages. */
    readonly languages: readonly string[];
    readonly vad: boolean;
    /** Word-level timestamps — false for the shipped engines. */
    readonly wordTimestamps: boolean;
  };
  readonly batch: {
    readonly available: boolean;
    readonly engine: SttBatchEngine;
    readonly model: string;
    readonly languages: readonly string[];
  };
  readonly audio: { readonly sampleRate: 16000; readonly channels: 1; readonly encoding: 'pcm_s16le' };
  readonly protocolVersion: 1;
};
```

```ts
/** WS /v1/stream — client → server. Audio frames are sent as binary messages. */
type SttClientMessage =
  | { readonly type: 'start'; readonly language?: string; readonly protocolVersion: 1 }
  | { readonly type: 'stop' };

/** WS /v1/stream — server → client. */
type SttServerMessage =
  | { readonly type: 'ready'; readonly capabilities: SttCapabilities }
  | { readonly type: 'speech-start'; readonly atMs: number }
  | { readonly type: 'partial'; readonly text: string; readonly atMs: number }
  | { readonly type: 'final'; readonly text: string; readonly startMs: number; readonly endMs: number }
  | { readonly type: 'speech-end'; readonly atMs: number }
  | { readonly type: 'error'; readonly code: SttErrorCode; readonly message: string };

type SttErrorCode =
  | 'model-not-loaded'
  | 'unsupported-language'
  | 'bad-audio-format'
  | 'protocol-version-mismatch'
  | 'overloaded'
  | 'internal';
```

TypeBox schemas in `packages/shared/schemas/`; derived types in
`packages/shared/types/` — so C-359's client and the service agree on one
definition rather than two hand-synced copies.

## Quality Requirements

- **Offline/degraded mode**: fully offline after model fetch. Model absent → the service fails its health check with a message naming the missing file, and the rest of the stack starts normally.
- **Accessibility/input**: this service *is* accessibility infrastructure (C-359). Partial hypotheses must arrive fast enough to give visible feedback while speaking, or the feature fails its purpose.
- **Performance budget**: first partial within 300 ms of speech onset; final within 500 ms of endpoint; batch RTF < 1.0 on CPU for the default model.
- **Security/privacy**: audio never written to disk, never logged, never leaves the machine. The service binds `127.0.0.1` by default. Websocket connections are rejected when the `Origin` header is not on an allowlist, so a random web page cannot open a socket to a localhost transcription service.
- **Persistence/migration**: no persistent state beyond the model files in the shared volume.
- **Cancellation/retry/idempotency**: closing the websocket immediately frees buffers and cancels in-flight decoding. A batch request cancelled by the client aborts decoding rather than completing into the void.
- **Observability**: log connection lifecycle, model load, language, and decode duration. **Never log transcript text** — it is user speech content.

## Migration & Rollback

- **Old data compatibility**: the current `models/stt/` tree may hold a Moonshine tarball from the existing entrypoint's ad-hoc download. Import it into the shared volume if the digest matches the manifest; otherwise re-fetch.
- **Migration**: additive — no consumer exists yet, so there is no client-side migration.
- **Rollback**: disable the `stt` profile. Nothing else in the stack depends on it.
- **Feature flag or kill switch**: the `stt` compose profile plus `ENABLE_STT`. Off by default in both.
- **Failure recovery**: a corrupt model is caught by digest verification and re-fetched.

## Scope Boundaries

- **In Scope:**
  - Streaming websocket protocol: message types, audio format, versioning, error codes.
  - OpenAI-compatible batch `POST /v1/audio/transcriptions`.
  - `GET /v1/capabilities` and a health check wired into the compose profile — extended so the voice healthcheck covers the STT endpoint, not just TTS.
  - Flipping the shipped defaults to STT-off: `.env.example` currently ships `stt` in `COMPOSE_PROFILES` and `ENABLE_STT=true`; the shipped default must be opt-in (AC-7).
  - Silero VAD with speech-start/speech-end events.
  - Manifest entries and tiers for Moonshine and whisper.cpp models.
  - Engine selection env vars leaving a seam for licensed providers.
  - Shared TypeBox schemas and types for the protocol.
  - Native macOS path via `bin/run-native-stt.sh`, and a smoke test script.
  - README section covering privacy posture and what the service does with audio.
- **Out of Scope:**
  - **All client-side work** — microphone capture, push-to-talk UI, wake word, command grammar, and the hands-free experience are C-359.
  - Shipping CrisperWhisper or any non-commercial-licensed weights. The seam is in scope; the provider is not.
  - Speaker diarisation, voice identification, and emotion detection.
  - Word-level timestamps. The shipped engines report `wordTimestamps: false`; the field exists so a future provider can report `true`.
  - Translation (whisper's `translate` task). Transcription only.
  - Cloud STT fallback.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — a usable local STT service. Streaming and
batch look separable, but they share the container, the model store, the
capabilities endpoint, and the schemas; splitting them would mean designing
`SttCapabilities` twice and shipping a service that advertises a protocol it
does not serve. The client work **is** separable and is C-359.

## Acceptance Criteria

### AC-1: Streaming produces partials then a final
**Given** the STT profile running with the default streaming model
**When** a client connects to `WS /v1/stream`, sends `start`, streams 16 kHz mono PCM of a spoken sentence, then sends `stop`
**Then** it receives `ready`, at least one `partial` before the utterance ends, exactly one `final` containing the transcript, and the socket closes cleanly.

### AC-2: VAD emits explicit endpoints
**Given** an audio stream with leading silence, speech, then trailing silence
**When** it is streamed
**Then** `speech-start` is emitted after the leading silence and `speech-end` after the utterance — and the client never has to infer endpointing itself.

### AC-3: Batch endpoint is OpenAI-compatible
**Given** the STT profile running
**When** a WAV file is posted as `multipart/form-data` to `POST /v1/audio/transcriptions` with a `file` field
**Then** the response matches OpenAI's transcription shape, and an unmodified OpenAI-compatible client succeeds against it — e.g. the official `openai` npm SDK's `client.audio.transcriptions.create()` with the same `file`/`model`/`response_format` args pointed at the local endpoint.

### AC-4: Capabilities are introspectable
**Given** the service running
**When** `GET /v1/capabilities` is called
**Then** it returns engines, loaded model names, supported languages, VAD availability, `wordTimestamps: false`, and the audio format — and it validates against the shared TypeBox schema.

### AC-5: Language limits are reported, not silently wrong
**Given** the streaming engine is Moonshine (English-only)
**When** a client sends `start` with `language: 'de'`
**Then** the service responds with `error: unsupported-language` naming the batch endpoint as the multilingual alternative — it does not transcribe German audio as garbled English.

### AC-6: Bad audio format fails fast and clearly
**Given** a client streaming 44.1 kHz stereo audio
**When** the first frames arrive
**Then** the service responds `error: bad-audio-format` stating the expected format, rather than producing nonsense transcripts.

### AC-7: Off by default
**Given** the default stack configuration — i.e. the shipped `.env.example`, which must not list `stt` in `COMPOSE_PROFILES` and must not set `ENABLE_STT=true`
**When** `docker compose up -d` runs without the `stt` profile
**Then** no STT service starts, no STT port is bound, and no STT model is downloaded.

### AC-8: Audio is never persisted or logged
**Given** the service handling a full streaming session and a batch request
**When** the container filesystem and the logs are inspected afterwards
**Then** no audio file was written anywhere, and no transcript text appears in any log line at any level.

### AC-9: Cross-origin websocket connections are rejected
**Given** the service running
**When** a websocket connection arrives with an `Origin` header not on the allowlist
**Then** it is rejected before any audio is accepted.

### AC-10: Health check reflects real readiness
**Given** the `stt` profile enabled but the model file absent
**When** the stack starts
**Then** the STT service reports unhealthy with a message naming the missing model file, and every other enabled service still reaches healthy.

### AC-11: Models come from the manifest
**Given** the STT manifest entries
**When** the C-390 fetcher runs for the selected tier
**Then** the models land in the shared volume, are digest-verified, and no weights exist in any image layer.

### AC-12: macOS runs natively
**Given** a macOS host
**When** the documented setup is followed
**Then** `bin/run-native-stt.sh` starts a working STT service on the same port and protocol as the container, and the smoke test passes against it.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `stt_service.test.ts` — fixture WAV over ws | N/A | Filled during verification |
| AC-2 | Integration | `stt_service.test.ts` — silence-padded fixture | N/A | Filled during verification |
| AC-3 | Integration | `stt_service.test.ts` — OpenAI-shaped POST | N/A | Filled during verification |
| AC-4 | Unit | schema validation test | N/A | Filled during verification |
| AC-5 | Integration | `stt_service.test.ts` | N/A | Filled during verification |
| AC-6 | Integration | `stt_service.test.ts` | N/A | Filled during verification |
| AC-7 | Integration | `scripts/check.sh` — default-profile port scan | N/A | Filled during verification |
| AC-8 | Integration | `scripts/check.sh` — fs diff + log grep | N/A | Filled during verification |
| AC-9 | Integration | `stt_service.test.ts` — bad Origin | N/A | Filled during verification |
| AC-10 | Integration | `scripts/check.sh` — model removed | N/A | Filled during verification |
| AC-11 | Integration | CI image-layer inspection | N/A | Filled during verification |
| AC-12 | Manual | Darwin run documented in the PR | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run local-stack:test`, `bun moon run local-stack:lint`
- Integration: start the `stt` profile, run the smoke script against a committed fixture WAV, assert the transcript matches within an edit-distance tolerance (exact-match assertions on ASR output are flaky by nature).
- E2E / Visual:
    - **Functional**: N/A — no UI in this contract; the E2E surface arrives with C-359.
    - **Visual**: N/A.

**Watch Points**:
- **Ports are already allocated — use them.** C-390 put STT at `8087` (emulator) / `8086` (staging) / `8090` (production) in `development_ports.ts`; compose and native scripts must not invent anything outside that. Caveat: staging `8086` numerically coincides with the Aikami pubsub emulator port — different modes, so they only collide when both run on one host. That is C-390's pre-existing allocation and is not re-litigated here.
- **Default-tier model must be reconciled with the shipped stack.** `compose.yaml` (`STT_DIR`), `entrypoint.sh`, and `bin/run-native-stt.sh` all reference `sherpa-onnx-moonshine-tiny-en-int8`, while this contract's default tier is Moonshine base int8. Re-point those references to the chosen default tier, or the shipped stack silently serves a different tier than the ACs test. The 300 ms first-partial budget is far easier to meet with tiny than with base — if base cannot hit it on CPU, ship tiny as the default and keep base as a higher tier.
- **The fetcher downloads every entry of a modality; there is no tier filter.** `TEXT_MODEL`/`IMAGE_MODEL` only select which file the engine loads — the fetcher itself fetches all entries of an enabled modality. Adding whisper.cpp `tiny`/`base`/`small` plus Moonshine base as STT entries means the `stt` profile downloads all of them unless an entry-selection mechanism is added (`STT_STREAM_MODEL`/`STT_BATCH_MODEL` wired into the fetcher, or an explicit `--entry` list). Size the manifest accordingly or gate by tier.
- **Moonshine is English-only.** Treating it as multilingual is the single most likely design mistake here; AC-5 exists specifically to prevent it.
- **Websocket through nginx** needs `Upgrade`/`Connection` header forwarding. If STT is ever proxied via the client container's nginx, `docker/client/nginx.conf` must be updated or connections fail with a confusing 400.
- **VAD aggressiveness is a real tuning knob.** Too sensitive truncates slow speakers mid-sentence; too lax makes hands-free feel unresponsive. Expose it as an env var rather than hardcoding, and record the chosen default and why.
- **ASR test assertions must tolerate variation.** Model updates change output slightly; use edit distance or keyword presence, not string equality.
- **Two processes in one container** (sherpa streaming + whisper.cpp batch) means the health check must cover both, or a dead batch process reports healthy. The existing `entrypoint.sh` supervises; extend it rather than adding a second supervisor.
- **`Origin` checks do not apply to native clients.** Tauri's webview and non-browser callers may send no `Origin` at all — the allowlist must handle absent headers deliberately, not by accident.

## Implementation Sequence

1. **Phase 1 (Protocol)**: TypeBox schemas and types for `SttCapabilities` and both message unions; document the wire contract. No runtime code yet — C-359 can start against this.
2. **Phase 2 (Streaming)**: Moonshine over websocket in the sherpa container, with Silero VAD and the speech-start/end events.
3. **Phase 3 (Batch)**: whisper.cpp with the OpenAI-compatible endpoint.
4. **Phase 4 (Integration)**: `/v1/capabilities`, health check, compose `stt` profile wiring, manifest entries, engine-selection env vars.
5. **Phase 5 (Native + docs)**: `bin/run-native-stt.sh` parity, smoke test script, README privacy section.
6. **Phase 6 (Validation)**: `bun moon run local-stack:test`, `:lint`, plus the fixture-WAV integration run.

## Edge Cases & Gotchas

- **Client disconnects mid-utterance**: decoding must be cancelled and buffers freed immediately, not left to a timeout.
- **Very long utterance**: a user who never stops talking must not grow an unbounded buffer. Cap utterance length, emit a `final`, and continue in a new segment.
- **Concurrent streaming sessions**: two clients on one CPU-bound decoder will both degrade. Either serialise with a clear `overloaded` error or document the concurrency limit — do not silently interleave and produce garbage.
- **Model loading is slow relative to the first connection**: a client connecting during warm-up must get `model-not-loaded` rather than a hung socket.
- **Sample-rate mismatch that is *plausible*** (e.g. 8 kHz telephony) produces confident nonsense rather than an obvious error. Validate explicitly; do not rely on output looking wrong.
- **Silence-only input**: must produce an empty `final`, not an error and not a hallucinated sentence. Whisper models are known to hallucinate on silence — VAD gating is the mitigation, and this case needs a test.
- **The privacy posture must be written down.** Users are handing a microphone to a local service; "we do not persist audio" belongs in the README, backed by AC-8, not assumed from the architecture.

## Open Questions — Resolved at Critique (2026-08-14)

These were open in the draft; each is resolved below from codebase evidence, so approval is not gated on them.

- **One container or two?** **Resolved: one.** C-390's implemented topology already hosts STT inside the `voice` service (`profiles: ["voice", "stt"]`, same image, same model volume) and the existing `entrypoint.sh` supervises both processes. Revisit only if whisper.cpp crash stability demands isolation.
- **Port triple?** **Resolved: 8087 / 8086 / 8090** (emulator/staging/production) — already allocated in `packages/shared/constants/src/lib/development_ports.ts` by C-390. See Watch Points for the staging-8086/pubsub coincidence note.
- **Batch formats?** **Resolved: WAV only in this contract.** Browser `MediaRecorder` produces webm/opus by default, so C-359 transcodes client-side (Web Audio → PCM/WAV) before posting; server-side webm/opus decoding is recorded as a known C-359 dependency and is out of scope here.
- **`wordTimestamps`?** **Resolved: sentence-level timing suffices for C-359.** The seam stays as designed — the `wordTimestamps: false` field plus the `STT_STREAM_ENGINE`/`STT_BATCH_ENGINE` env values — so a future licensed CrisperWhisper provider can report `true` without a protocol change.

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
Built the C-393 STT service as a two-protocol surface on the existing sherpa
voice container: a stdlib-only streaming websocket server (`stt_server.py`,
Moonshine + Silero VAD, `WS /v1/stream`) plus an OpenAI-compatible batch
proxy over whisper.cpp (`POST /v1/audio/transcriptions`), with
`GET /v1/capabilities` and a model-aware `GET /health`. Shared TypeBox
schemas/types define the wire contract for C-359. STT is opt-in: shipped
defaults (`COMPOSE_PROFILES`, `ENABLE_STT`) are off, the STT port publishes
only via a new `compose.stt.yaml` override, the model fetcher tier-selects
STT entries, and the manifest pins Moonshine base + whisper tiny/base/small
+ Silero VAD digests. Verified live: the voice image builds (sherpa-onnx
1.13.4 + whisper.cpp v1.9.2), the full wire contract passes
(`stt_service.test.ts`, 8/8), and check.sh's C-393 live probes (AC-8 fs/log,
AC-10 missing-model) pass. AC-12 (Darwin) is scripted and static-checked but
not executed — no macOS host in this environment.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Streaming partials + exactly one final verified live (fixture WAV over WS) |
| AC-2 | ✅ | speech-start / speech-end emitted by Silero VAD, verified live |
| AC-3 | ✅ | Batch endpoint OpenAI-shaped; proxy rewrites to whisper `/inference`; live `{"text": ...}` verified |
| AC-4 | ✅ | `/v1/capabilities` validates against the shared schema (unit + live) |
| AC-5 | ✅ | `language: de` → `unsupported-language` naming the batch endpoint (live) |
| AC-6 | ✅ | 44.1k stereo stream → `bad-audio-format` naming the expected format (live) |
| AC-7 | ✅ | `.env.example` ships stt-off; `compose.stt.yaml` gates the port; check.sh asserts no-STT render |
| AC-8 | ✅ | Live fs scan + log grep: no audio files, no transcript text |
| AC-9 | ✅ | Disallowed Origin → HTTP 403 before any audio (live) |
| AC-10 | ✅ | Missing model → `/health` 503 naming the file (throwaway container, live) |
| AC-11 | ✅ | Manifest tiers with pinned SHA-256; fetcher tier selection; no weights COPYed into the image |
| AC-12 | ⚠️ | `run-native-stt.sh` rewritten for the protocol; static checks pass; Darwin run deferred (no macOS host) |

### Files Created
| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/local_ai/stt.ts` | TypeBox wire-protocol schemas (capabilities, client/server messages, error codes) |
| `packages/shared/schemas/src/lib/local_ai/stt.test.ts` | 23 schema-validation tests (AC-4) |
| `packages/shared/types/src/lib/local_ai/stt.ts` | `Static<typeof Schema>` derived types for C-359 |
| `apps/backend/local-stack/docker/voice/stt_server.py` | Streaming WS server + capabilities + health + batch proxy (stdlib only) |
| `apps/backend/local-stack/compose.stt.yaml` | STT port publish override (AC-7 — conditional port) |
| `apps/backend/local-stack/stack/stt.test.ts` | Manifest + fetcher tier-selection tests (AC-11) |
| `apps/backend/local-stack/stack/stt_service.test.ts` | Live wire-contract integration tests (AC-1..AC-10) |
| `apps/backend/local-stack/stack/fixtures/stt_test_utterance.wav` | Committed 16k mono fixture WAV (TTS-generated) |

### Files Modified
| File | Change |
|---|---|
| `packages/shared/schemas/src/index.ts` | barrel export for `stt.ts` |
| `packages/shared/types/src/index.ts` | barrel export for `stt.ts` |
| `apps/backend/local-stack/docker/voice/Dockerfile.sherpa` | whisper.cpp v1.9.2 build (static), libgomp1 runtime, stt_server.py COPY |
| `apps/backend/local-stack/docker/voice/entrypoint.sh` | manifest-driven STT startup (stream + whisper batch), no ad-hoc model download |
| `apps/backend/local-stack/compose.yaml` | STT envs, dual healthcheck (TTS+STT), no unconditional STT port |
| `apps/backend/local-stack/.env.example` | STT off by default; tier + override docs |
| `apps/backend/local-stack/stack/models.manifest.json` | Moonshine base, whisper tiny/base/small, Silero VAD entries (pinned digests) |
| `apps/backend/local-stack/stack/fetch_models.ts` | STT tier selection (empty-string-safe), VAD always fetched |
| `apps/backend/local-stack/stack/env_writer.ts` | `stack init` appends `compose.stt.yaml` when stt is planned |
| `apps/backend/local-stack/bin/run-native-stt.sh` | Native path parity (stt_server.py + optional whisper-server) |
| `apps/backend/local-stack/scripts/check.sh` | AC-7/AC-11 static checks; C-393 live probes (wire contract, AC-8, AC-10) |
| `apps/backend/local-stack/README.md` | STT section: protocol, tiers, privacy posture, smoke-test matrix |
| `apps/frontend/docs/src/content/docs/guides/run-locally.mdx` | STT endpoints, opt-in note, macOS native path |

### Deviations from Spec
- **STT port publish is conditional via `compose.stt.yaml`** (AC-7 requires
  "no STT port is bound" with defaults; Compose cannot conditionally publish
  per-profile). Enabling STT now needs `compose.stt.yaml` in COMPOSE_FILE —
  documented in `.env.example`/README and wired into `stack init`
  (`env_writer.ts`).
- **Shipped default tier is minimal** (Moonshine tiny + whisper tiny), not
  the "default" tier in the tier table — the Watch Point allows this when
  the 300 ms first-partial budget demands it; `stack init` and `.env`
  document the other tiers.
- **whisper.cpp v1.9.2 does not expose `/v1/audio/transcriptions`** — its
  server endpoint is `/inference` with an OpenAI-shaped `{"text": ...}`
  response. The proxy rewrites the path; the public wire contract remains
  OpenAI-compatible (verified with the same multipart shape the openai SDK
  sends).
- **sherpa-onnx 1.13.4 Python API facts** (verified against the shipped
  wheel): Moonshine uses `OfflineRecognizer.from_moonshine(...)`; decode
  results come from `stream.result`; VAD uses `empty()`/`front` (property);
  `SpeechSegment.start` is a sample index.
- **Live integration tests require an explicit `STT_URL` env** so the plain
  unit run stays hermetic; check.sh's live section sets it.
- **AC-12 (Darwin)**: scripted and statically asserted only — no macOS host
  available in this environment for a live run.

### Test Results
- Unit: 88/88 pass (local-stack, incl. 9 STT manifest/fetcher tests), 23/23
  schema tests (schemas package), 348/348 schemas suite — 0 failures.
- E2E (live): `stt_service.test.ts` 8/8 pass against the built voice
  container (AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-9, AC-10).
- Visual: N/A (no UI in this contract).
- Baseline: 0 pre-existing failures; 0 new failures. `check.sh --static`
  87/87; live `LOCAL_STACK_LIVE=1` run: 97 pass, 3 environment-scoped
  failures (AC-4 text/image/web probes — those engines were not started in
  the stt-only verification stack; they are pre-existing C-390 stack checks).
