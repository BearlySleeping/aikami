---
id: C-393
title: "Speech-to-Text Backend Service (sherpa-onnx streaming + whisper.cpp batch)"
source: "user request — 'also setup contract for speech to text setup (for backend)'"
status: draft
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
| **Target** | `apps/backend/local-stack/docker/voice/`, the `stt` compose profile, `stack/models.manifest.json`, `packages/shared/{schemas,types}/` |
| **Priority** | P2 — no consumer exists until C-359 (Speech Input and Hands-Free Play). Land it before that work starts, not before. |
| **Dependencies** | C-390 (compose topology, `stt` profile, port constant, model manifest and fetcher). C-389 reserves `voice.stt.url` in the runtime client config. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | user-facing → the voice section of "Run Aikami locally"; internal → the STT API contract that C-359 codes against |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Nothing in the client consumes STT today.** A search across `apps/frontend/client/src` and `packages/frontend` for `whisper`, `SpeechRecognition`, `transcrib`, and `moonshine` returns only unrelated matches (export formatters, test fixtures). C-359 is the intended consumer and is still `not_started`. This is greenfield, and the API surface is therefore free to be designed rather than retrofitted.

- **The infrastructure is half-present but undefined.** `apps/backend/local-stack/docker/voice/entrypoint.sh` already supports `ENABLE_STT` (default `false` in `docker-compose.yml`), and the current README documents a Moonshine tiny int8 model downloaded into `models/stt/` and a websocket server on `6007`. But there is no health check, no model manifest entry, no documented protocol, no language handling, no VAD, and no smoke test. It is a placeholder, not a service.

- **C-390 provisions the slot without filling it.** It adds an `stt` compose profile, an `stt` port constant, and the model-store plumbing. It explicitly leaves the engine and API definition out of scope.

- **The two candidate engines solve different problems, and picking one is wrong.**
  - **sherpa-onnx / Moonshine** (MIT) — streaming websocket, tiny, shares the C++ binary already used for TTS, produces partial hypotheses as the user speaks. Right for push-to-talk and hands-free.
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
  STT and TTS are the same binary and the same model store. whisper.cpp is a
  separate process and may be a separate container behind the same profile,
  but must not duplicate the model volume.
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
  - `GET /v1/capabilities` and a health check wired into the compose profile.
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
**Then** the response matches OpenAI's transcription shape, and an unmodified OpenAI-compatible client library succeeds against it.

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
**Given** the default stack configuration
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
- **The port must fit the allocated range.** `development_ports.ts` documents `8087–8092` for Aikami backend services, with `8088`/`8089`/`8092` already taken by voice across the three modes. STT needs an emulator/staging/production triple inside a range that is nearly full — resolve the allocation with C-390 rather than inventing a number outside the table.
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

## Open Questions

Must be resolved before status becomes `approved`:

- One container running both engines, or two containers behind one profile? One keeps the model volume and supervision simple and matches the existing `entrypoint.sh`; two isolates a whisper.cpp crash from TTS. Proposed: one, extending the existing supervisor, revisited if stability suffers.
- Which port triple for STT, given `8087–8092` is nearly exhausted? This must be settled jointly with C-390's port work rather than independently.
- Should the batch endpoint accept formats other than WAV (mp3, ogg, webm)? Browser `MediaRecorder` produces webm/opus by default, so C-359 will either transcode client-side or need server-side decoding. Deciding now avoids a painful retrofit — proposed: accept WAV only in this contract, and record webm/opus as a known C-359 dependency.
- Is `wordTimestamps` worth a licensed CrisperWhisper provider later, or is sentence-level timing sufficient for everything C-359 wants? Answering shapes how much the seam needs to carry.

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
