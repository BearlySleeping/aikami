---
id: C-521
title: "Music and SFX generation with audio preparation"
source: "direct — 2026-09-13 asset generation and Emberwatch review"
contract_type: full
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-13T00:00:00Z"
---

# Contract C-521: Music and SFX generation with audio preparation

## Metadata

| Field | Value |
|---|---|
| **Source** | User request; [Asset generation review](../research/asset-generation-review-2026-09.md) |
| **Target** | shared local-ai audio adapters; local-stack audio profiles; media processors; client Studio audio workflow |
| **Type** | full |
| **Priority** | P1 — production asset pipeline |
| **Dependencies** | C-511, C-517–C-519; C-512 for Studio audio review. Sibling drafts are not hard prerequisites: C-520 owns the image-side media-processor core and C-522 the Hub/runner front door — extend whichever lands first rather than creating a second authority. |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | User-facing generation/creating-assets guides; affected Hub help |
| **Contract version** | 1.0.0 |
| **Production Surface** | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` audio review; client `/game` offline pack playback |

Allocated as C-521 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-520; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/research/asset-generation-review-2026-09.md`.
## Problem & Baseline Evidence

Aikami ships ACE-Step v1 3.5B with a filesystem-only result path. Music, SFX and ambience use the same model. There is no reusable loop/loudness/codec finishing path; the old converter is hardcoded to legacy files.

Inspect the source in the reuse map at current HEAD before implementation. Baseline is source-reviewed, not freshly test-executed. Run the related existing project tests before editing; do not copy old contract execution reports as current evidence.

## User Outcome

A creator can generate a music cue or sound effect, hear its actual loop/one-shot behavior, and save a validated runtime rendition through the same pipeline as images.

## Success Measures

- Every mandatory AC below has execution evidence on its named production/tooling path.
- Generation stays asynchronous; no model/GPU/network/sign-in dependency is added to game boot, play or saves.
- Generation latency is measured on named hardware, not inferred from vendor marketing. Cache/accepted outputs are reused without regeneration.

## Existing System & Reuse Map

| Existing source | Action |
|---|---|
| `packages/shared/local-ai/src/lib/engines/ace_step_engine.ts` | keep v1 compatibility |
| `packages/shared/local-ai/src/lib/recipes/recipe_registry.ts` | extend typed profile/capability validation for audio recipes |
| `apps/backend/local-stack/stack/models.manifest.json` | pin new complete model sets |
| `apps/backend/local-stack/stack/ace-step.Dockerfile` | follow pinned-build conventions |
| `apps/backend/local-stack/stack/generation/` | dispatch through the existing durable runner, job store and resource lease (C-519) |
| `packages/shared/constants/src/lib/asset_batch.ts` | extend the existing `modality: 'audio'` recipe/brief definitions, not a parallel set |
| `packages/shared/constants/src/lib/game_assets.ts` | `AUDIO_EXTS`, `AUDIO_EXT_MIME` and `MAX_UPLOAD_SIZE` are the authoritative installed-catalog limits |
| `apps/frontend/client/src/lib/views/studio/studio_composition.ts` | register the audio adapter against the existing modality-neutral registry (already reserved for C-521) |
| `apps/frontend/client/src/lib/services/audio/` | reuse existing playback and resolver |
| `scripts/src/lib/ops/convert_audio.ts` | reuse codec intent, not legacy paths |

## Overview

A creator can generate a music cue or sound effect, hear its actual loop/one-shot behavior, and save a validated runtime rendition through the same pipeline as images. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/research/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Add a versioned ACE-Step 1.5 protocol/profile without pretending it is the v1 `/generate` API. Pin upstream server commit plus all decoder/LM/tokenizer/codec artifacts and licenses. Start with 2B turbo; expose higher-quality SFT/XL only when configured hardware passes readiness. Retain the v1 recipe/profile for rollback.
- Follow the verified v1.5 REST flow: POST /release_task, POST /query_result, then scoped retrieval of returned audio. Record native task IDs immediately. Select output format explicitly (API defaults can be MP3). Do not expose its arbitrary path query to clients; translate through the runner's owned artifact IDs and enforce size/origin/path bounds.
- Add an opt-in Stable Audio Open 1.0 local SFX/ambient profile under the same job/adapter contract after model-license eligibility is resolved. If unavailable, import owned/licensed recordings. Do not silently fall back to a music model for one-shots. Do not modify default COMPOSE_PROFILES to start new GPU services.
- Build host-side ffmpeg/ffprobe finishing with argument arrays, no shell interpolation from prompts/paths. Keep raw masters plus derivative lineage. Inspect actual decoded audio, not just WAV header fields or provider metadata. Bound duration, channels, sample rate, output bytes and decode resource use.
- Initial profiles: archival lossless master; music/ambient runtime 48 kHz stereo Opus where the supported client runtime decodes it, with a proven alternative rendition where required; short positional SFX PCM WAV mono; UI/stereo effects explicitly declared. Hash each rendition separately. Keep the installed catalog's supported extensions authoritative: `AUDIO_EXTS` today lists `.mp3 .ogg .wav .flac .m4a .aac .webm` and no bare `.opus`/`.oga`, so deliver Opus inside `.webm` (as the legacy converter already does) or `.ogg`, or widen the constant deliberately with migration impact stated. Declared renditions stay within `MAX_UPLOAD_SIZE` unless a bounded, explicit exception is added.
- Proposed mix targets are tunable project choices: music about -18 LUFS-I (±2), ambience about -24 LUFS-I (±3), music/ambient true peak ≤-1 dBTP. Short SFX use category peak/RMS listening calibration, not unreliable integrated LUFS. Never normalize a near-silent noise floor into a loud effect. Detect nonfinite samples, empty/truncated clips, clipping, DC offset and excessive silence.
- Loopable is not a prompt guarantee. Author loopStartSample/loopEndSample at the runtime sample rate, select clean musical boundaries, optionally crossfade a measured window, and audition at least five repeats. Re-check after lossy encoding; encoder delay can break loops. Prefer decoded AudioBuffer scheduling for exact loops when supported; use current music player for full tracks, not a second competing player.
- Preserve music structure and original motif references. Reference audio carries rights/hash and is uploaded to a hosted provider only through an explicit authorized workflow. Do not promise independently phase-aligned stems unless the model outputs stems and synchronization is measured.
- Studio uses the shared modality-neutral runner with progress, waveform/play/pause, loop audition and save; no fetching blob URLs in view models or browser filesystem assumptions.

## State & Data Models

AudioRendition carries content hash, codec/container, measured sampleRate/channels/sampleCount/duration, optional loop sample bounds, loudness/peak analysis and parent master hash. AudioCue later binds these to pack state in C-523. Requested BPM/key and measured values are separate.

All cross-boundary data has TypeBox schemas under packages/shared/schemas and Static-derived types under packages/shared/types. Portable generation core has no Bun/fs/Svelte imports. Use type aliases, not interfaces. New field names are proposed contracts, not claims that today's strict pack schemas already accept them.

## Quality Requirements

- **Offline/degraded mode:** accepted installed assets stay usable without the runner or Hub; unavailable generation returns a typed reason.
- **Accessibility/input:** labelled keyboard controls and status/error announcements for affected UI; CLI surfaces use stable JSON and meaningful exit codes.
- **Performance budget:** default GPU concurrency one; bounded job/payload/artifact sizes; media preparation off the game render thread. Measure wall time, decoded memory and queue behavior.
- **Security/privacy:** validate boundaries, keep secrets/private prompts out of public projections, permit only owned artifact references and supported operations.
- **Persistence/migration:** Add optional profiles and rendition metadata. Legacy single-file audio remains a valid rendition without fabricated loop bounds. Preserve v1 endpoint/model options. A feature flag disables new generation independently of playback; no accepted asset is rewritten in place.
- **Cancellation/retry/idempotency:** distinguish stopped waiting from confirmed native cancellation; do not repeat uncertain generation automatically; byte identity is SHA-256.
- **Observability:** job/candidate/profile/hash IDs, stage timings and failure codes; no raw private prompts, credential material or audio/image payloads in routine logs.

## Migration & Rollback

Add optional profiles and rendition metadata. Legacy single-file audio remains a valid rendition without fabricated loop bounds. Preserve v1 endpoint/model options. A feature flag disables new generation independently of playback; no accepted asset is rewritten in place.

## Scope Boundaries

Local music/SFX production and finishing plus Studio audio review. Excludes voice cloning, new TTS, hosted credentials and authoritative story-state changes. Also excludes cue-to-map/pack binding and resolver arbitration (C-523), the Hub front door and runner pairing (C-522), and community publication (C-513).

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: New API is real

**Given** pinned ACE-Step 1.5 readiness and installed models, **when** generate instrumental music through batch and Studio, **then** native task tracking, HTTP artifact retrieval and registry save work; the compiled HTTP payload carries the subject and the recipe tags together (a generic tag-only prompt is a failure); BPM/key remain labelled as requested, never as measured or guaranteed conditioning; no browser reads a server path, and an artifact reference outside the runner's owned IDs or outside the declared size/origin bounds is rejected with a typed reason.

### AC-2: SFX are a distinct capability

**Given** a license-eligible installed SFX profile and a gate-slam brief, **when** generate a one-shot and ambience, **then** the declared SFX/ambient model and profile are used rather than the music model; unsupported configuration is explicit; listening rejects music/vocals in the effect. **And given** no license-eligible SFX model is installed, **then** SFX generation is refused with a typed reason rather than silently falling back to a music model, and imported owned/licensed recordings enter the same finishing/analysis path and produce a rendition record.

### AC-3: Finishing is reproducible

**Given** fixed masters including clipped/silent/truncated/nonfinite/DC-offset fixtures, **when** process each profile twice, **then** valid rendition hashes repeat for pinned tools; measured integrated loudness and true peak land inside the profile's declared tolerance (music ≈ -18 LUFS-I ±2, ambience ≈ -24 LUFS-I ±3, true peak ≤ -1 dBTP); a near-silent master is never normalised into a loud effect; invalid clips fail with the named finding code; each rendition records its parent master hash, and actual metadata agrees with decoded bytes rather than file-header fields or provider claims.

### AC-4: Loops survive delivery

**Given** accepted music and ambience with authored sample bounds, **when** encode, load in the supported client runtime and play five repeats, **then** no audible click/gap, loop sample bounds are valid for the decoded rendition, and the Studio candidate review exposes progress, an audio waveform, labelled keyboard play/pause, loop audition and mute with status/error announcements.

### AC-5: Resource/offline behavior

**Given** no GPU, unreachable engine, and a cached accepted track, **when** open Studio and play the pack offline in `/game`, **then** unavailable generation is explained with a typed reason; playback and saves still work with no runner/Hub/sign-in call; generation does not block movement/dialogue/combat.

### AC-6: Version rollback

**Given** v1 and v1.5 recipes coexist, **when** switch the default audio profile, revert it, and toggle the disable-new-generation flag, **then** old accepted audio remains playable and unrewritten; v1 endpoint/model preferences still resolve; playback is unaffected by the flag; models never auto-download on game boot.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | adapter CI + live GPU/Studio smoke | Captured HTTP request/response log (asserting subject + tags in the payload) + runner artifact record | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` audio review | Unverified — populate during execution |
| AC-2 | adapter integration + blind listening report | Blind listening notes + the descriptor/manifest entry showing the SFX profile (or the typed refusal record) | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` audio review | Unverified — populate during execution |
| AC-3 | processor integration | Repeated-hash report + decoded-byte metadata comparison + loudness/true-peak measurements per profile | tooling: `bun run --cwd apps/backend/image generate:batch` finishing path | Unverified — populate during execution |
| AC-4 | client audio journey + listening evidence | Five-repeat listening notes + decoded loop-bound measurements + Studio review session/screenshot | client `/studio/assets` audio review | Unverified — populate during execution |
| AC-5 | production smoke (offline) | Offline session log with the typed unavailable reason and no runner/Hub requests | client `/game` offline pack playback | Unverified — populate during execution |
| AC-6 | compatibility integration | Profile-switch/revert transcript + flag-off playback check | client `/game`; client `/studio/assets` | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted: existing affected tests under local-ai, schemas, frontend storage, client, Hub and scripts as applicable. Determine exact Moon project task names from current moon.yml; do not invent passing task output.
- Functional E2E: Playwright in apps/e2e/tests/client or tests/hub, exercising the production path above. Use compiled Svelte tests for reactivity/lifecycle.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Add the `AudioRendition`/rendition-profile TypeBox schemas and Static types in `packages/shared/schemas` and `packages/shared/types`, plus the optional profile/flag fields — no behavior change yet.
2. Implement the versioned ACE-Step 1.5 API adapter with recorded protocol fixtures.
3. Pin complete audio model sets and the optional license-eligible SFX profile.
4. Implement deterministic finishing/analysis, lineage and scoped retrieval.
5. Wire the Studio audio adapter into `studio_composition.ts` and run live generation/loop tests.

## Edge Cases & Gotchas

The current 50 MiB asset cap may be reached by long uncompressed audio. Keep masters in bounded authoring storage and publish supported smaller renditions; do not casually raise all upload limits.

## Open Questions

No conceptual choice is required to begin the scoped implementation. Hardware, credentials, model/license eligibility and actual measured performance are execution preflight facts. Use the declared unavailable/fallback behavior rather than inventing access or silently expanding scope. Record any new material design question before changing the contract.

## Amendments

This is a newly proposed draft; existing contract approval/amendment rules still apply. Do not self-assign user approval or upgrade status based on this document's presence.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-13 | Initial proposed scope | Pending contract adoption |

## Promotion Lifecycle

See docs/contracts/SHARED_SECTIONS.md. An implemented code path without required production, visual or audio evidence is not release_verified.

## Status Lifecycle

See docs/contracts/SHARED_SECTIONS.md. Preserve accurate draft/implemented/verified/completed distinctions.

## Execution Report

### Summary

C-521 shipped the portable audio-preparation core, the versioned ACE-Step 1.5
adapter, the host-side ffmpeg finisher, the SFX/ambience capability guard, and
the Studio audio review surface. The core is real and measured: BS.1770-4
integrated loudness and Annex-2 true peak are validated against the EBU Tech
3341 test signal, finishing is exercised against a real ffmpeg 8.1.2 on this
host, and two passes over one master produce byte-identical rendition hashes.

Three things are deliberately **not** claimed, each with a named blocker:

1. **Live generation (AC-1/AC-2 "listen" evidence).** No GPU, no pinned v1.5
   server and no installed Stable Audio model exist on this host. The v1.5
   adapter is verified against *recorded protocol fixtures* (HTTP request
   shape, task-id recording, poll states, scoped retrieval, all refusal
   paths), not against a live server. The recorded status table is declared as
   a re-verifiable preflight item.
2. **Studio audio generation.** ACE-Step v1.5 returns a path on the *engine's*
   filesystem, and this contract forbids exposing that to a client. The
   translation layer is the Hub/runner front door owned by **C-522**, still a
   draft. So the Studio audio adapter registers, probes honestly and states
   that reason; there is no browser-reachable audio generation path yet. The
   tooling path (`generate:batch` + the host finisher) is where audio actually
   gets produced today.
3. **The one-shot SFX model.** No licence-eligible SFX model is installed, so
   SFX generation is *refused with a typed reason* — which is the AC-2
   fallback behaviour, not a gap. A declared SFX model would be picked up
   automatically (`AUDIO_JOB_KIND_SOURCES`).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ⚠️ | Adapter complete and tested against recorded fixtures: subject+tags compiled into one payload, explicit output format, native task id recorded at submission, `query_result` poll with progress and a recorded status table, scoped artifact retrieval that rejects foreign origins, `..` traversal, escaping paths and arbitrary query strings. **Not verified live** — no pinned v1.5 server/GPU, so no captured live HTTP log exists. BPM/key are labelled `requested*`, never measured. `capabilities.cancel === false`, and a poll deadline says the *wait* stopped and the native task was NOT cancelled. |
| AC-2 | ⚠️ | Distinct capability enforced by `AUDIO_JOB_KIND_SOURCES` + `guardProfileForJobKind`: a music model can never serve `sfx`; ambience reaches it only as a *declared* `usedMusicModelFallback`. With no licence-eligible SFX model, SFX is refused with a typed `model_license_undecided` refusal naming the reason — tested. **Blind-listening evidence is absent**: nothing could be generated to listen to. |
| AC-3 | ✅ | Deterministic finishing verified with real ffmpeg 8.1.2: two passes over one master produce the same SHA-256; a -30 dBFS master is finished to -18 LUFS ±2 with true peak ≤ -1 dBTP; the archival master is unmodified and is its own lineage parent; clipped / non-finite / DC-offset / truncated masters fail with the named finding codes; a near-silent master is refused *before* ffmpeg is invoked. Metadata comes from decoded PCM (ffmpeg → float32 → real decode), never from a header or provider claim. |
| AC-4 | ⚠️ | Loop authoring, validation, seam checking and post-encoding re-alignment are implemented and tested (units + real-opus integration: authored bounds are re-located inside the decoded rendition). The Studio panel exposes waveform, labelled play/pause, loop audition, mute and `aria-live` announcements, verified in a real Chromium session (Announcement transitions Play→Loop→Mute→keyboard-toggle, 240-bucket waveform, loop-region overlay). **Five-repeat listening evidence is absent** — that requires a decoded loop played back by ear; the loop seam is verified numerically and visually, not audibly. |
| AC-5 | ⚠️ | The typed unavailable reason is rendered in production at `/studio/assets` for Music Track / Sound Effect / Ambient Loop (verified by DOM text from a real browser session). Playback and saves are untouched by the flag and by the runner's absence. **Not exercised:** the offline `/game` pack-playback session log (no audio pack exists in this checkout) and the movement/dialogue/combat non-blocking check. |
| AC-6 | ⚠️ | v1 and v1.5 profiles coexist with an explicit `protocol`/`modelId` on each; `PUBLIC_AUDIO_GENERATION` disables *new* generation only, and the refusal text states that playback and accepted assets are unaffected; no accepted asset is rewritten in place. **Not exercised:** an actual profile-switch/revert transcript against accepted audio and the v1 endpoint preference resolution (both need a live engine). No model auto-download is added anywhere. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/media/audio_rendition.ts` | `AudioRendition`, findings, analysis, loop bounds, rendition bundle and the typed generation refusal |
| `packages/shared/types/src/lib/media/audio_rendition.ts` | Static-derived types for the above |
| `packages/shared/local-ai/src/lib/audio/wav_decode.ts` | Real RIFF/WAVE decoder (u8/s16/s24/s32/f32/f64), truncation and empty-data detection |
| `packages/shared/local-ai/src/lib/audio/loudness.ts` | BS.1770-4 K-weighting, gated integrated loudness, Annex-2 true peak, RMS |
| `packages/shared/local-ai/src/lib/audio/audio_analysis.ts` | Decoded-sample findings (clipping, non-finite, DC offset, excessive silence) and the near-silent guard |
| `packages/shared/local-ai/src/lib/audio/audio_rendition_profiles.ts` | The five finishing profiles (master / music / ambience / positional SFX / UI stereo) and the tolerance check |
| `packages/shared/local-ai/src/lib/audio/audio_finishing.ts` | Rendition assembly, deterministic hashing, loop validation/seam/alignment, RMS calibration, the ffmpeg argv plan |
| `packages/shared/local-ai/src/lib/audio/audio_capability.ts` | Job-kind → profile resolution, typed refusals, the music-model guard |
| `packages/shared/local-ai/src/lib/audio/waveform.ts` | Peak envelope + sample-to-seconds helpers |
| `packages/shared/local-ai/src/lib/audio/index.ts` | Barrel |
| `packages/shared/local-ai/src/lib/engines/ace_step_v15_engine.ts` | The versioned v1.5 adapter (`release_task` → `query_result` → scoped retrieval) |
| `packages/shared/local-ai/src/lib/__fixtures__/audio_bytes.ts` | Deterministic synthetic audio + WAV encoders for tests |
| `packages/shared/local-ai/src/lib/__fixtures__/ace_step_v15_protocol.ts` | The recorded v1.5 wire conversation |
| `packages/shared/local-ai/src/lib/audio/loudness.test.ts`, `wav_decode.test.ts`, `audio_finishing.test.ts`, `audio_capability.test.ts`, `waveform.test.ts`, `src/lib/engines/ace_step_v15_engine.test.ts` | 88 focused tests for the above |
| `apps/backend/local-stack/stack/generation/audio_finishing.ts` | Host finisher: ffmpeg argv execution, loudnorm first pass, decode-back-to-PCM, loop re-alignment |
| `apps/backend/local-stack/stack/generation/audio_finishing.test.ts` | Real-ffmpeg integration tests (repeat hashes, tolerances, refusals) |
| `apps/frontend/client/src/lib/services/audio/audio_candidate_review.svelte.ts` | Decoded-buffer review player (exact `AudioBuffer` loop scheduling, peaks, mute) |
| `apps/frontend/client/src/lib/services/assets/audio_generation_flag.ts` | `PUBLIC_AUDIO_GENERATION` — new-generation-only kill switch |
| `apps/frontend/client/src/lib/utils/studio_audio_messages.ts` | The panel's status/error announcement copy |
| `apps/frontend/client/src/lib/views/studio/studio_audio_review.svelte` | The review panel (waveform, transport, loop, mute, live region) |
| `apps/frontend/client/src/lib/views/studio/studio_audio_adapter.ts` | The registry's audio adapter (probe + stated unavailability) |
| `apps/frontend/client/src/lib/views/studio/studio_audio_support.ts` | Pure audio/draft/pack/library derivations |
| `apps/frontend/client/src/lib/views/studio/studio_file_support.ts` | The ViewModel's file/format/error helpers, extracted to keep it under the size ceiling |
| `apps/frontend/client/src/lib/views/dev/studio-audio/studio_audio_review_view_model.dev.svelte.ts`, `studio_audio_review_view.dev.svelte` | Dev sandbox ViewModel + view |
| `apps/frontend/client/src/routes/(dev)/dev/studio-audio/+page.svelte` | Dev sandbox route |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/local-ai/src/index.ts`, `src/lib/engines/index.ts` | Export the audio core and the v1.5 adapter |
| `packages/shared/schemas/src/index.ts`, `packages/shared/types/src/index.ts` | Export the audio rendition schema/types |
| `packages/shared/constants/src/lib/asset_batch.ts` | Real v1.5 profile (`protocol`/`modelId`/`jobKinds`/`licenseResolved`), a v1 rollback profile, job kinds on the SFX/import profiles |
| `apps/frontend/client/src/lib/views/studio/studio_composition.ts` | Register the audio adapter; wire `audioReview` + `isAudioGenerationEnabled` |
| `apps/frontend/client/src/lib/views/studio/studio_view_model.svelte.ts` | Audio candidate state, the flag branch, candidate decode + reset |
| `apps/frontend/client/src/lib/views/studio/studio_view.svelte` | Audio branch of the review step |
| `apps/frontend/client/src/lib/types/studio.ts` | `StudioAudioReview` capability + the two optional capability hooks |
| `apps/frontend/client/src/lib/services/index.ts` | Export the review service + the audio flag |
| `apps/frontend/client/src/env.ts`, `src/env.d.ts` | Declare `PUBLIC_AUDIO_GENERATION` |
| `scripts/src/lib/ops/guard_orphaned_capability_baseline.json` | Baseline the two service-contract exports (interface/options) |
| `apps/frontend/docs/src/content/docs/guides/creating-assets.mdx` | Document the audio path and the flag |
| `apps/backend/local-stack/stack/generation/index.ts` | Export the host finisher |

### Deviations from Spec

- **`AUDIO_JOB_KIND_SOURCES` (ambience fallback).** AC-2 says SFX *and* ambience
  must use the declared SFX/ambient model. With no such model installed, the
  contract only names a refusal for SFX. Ambience therefore resolves to the
  music model as a **declared** fallback (`servedAsKind: 'music'`,
  `usedMusicModelFallback: true`) rather than being refused; a music profile
  never serves `sfx`. If the intent is that ambience must also be refused, that
  is a one-line change — flagged for the verifier rather than decided silently.
- **`.webm` delivery for Opus.** Kept inside `.webm`, as the contract directs
  (no widening of `AUDIO_EXTS`). No migration is implied.
- **`ffprobe` is not used.** Decoded-byte metadata comes from decoding the
  encoder's output to float32 PCM and reading the samples; `ffprobe` would
  re-report a container header, which is exactly what AC-3 says not to trust.
- **No `generate:batch` CLI extension.** The finisher is exported from
  `@aikami/local-stack/generation` and unit-integrated, but the batch CLI is not
  rewired to call it: doing so would extend C-519's command surface, and the
  audio job kinds in that path still resolve to an unshipped SFX model. This is
  the largest remaining gap — flagged for a follow-up rather than silently
  broadening this contract.
- **Studio audio generation** is blocked on C-522 (see Summary). Not a scope
  reduction: the adapter is registered exactly as the contract asks, and it
  states the missing front door instead of fabricating a path fetch.

### Test Results

- Unit (shared/local-ai): 403/403 PASS, 0 failures (88 new C-521 tests) — includes
  EBU Tech 3341 loudness conformance and the inter-sample-peak true-peak check.
- Unit (shared/constants): 161/161 PASS, 0 failures.
- Unit (client, full suite): 3156/3163 PASS, 0 failures, 7 pre-existing skips, 2 todos.
- Unit (apps/backend/local-stack): 153 PASS, 8 pre-existing skips, 0 failures.
- Integration (real ffmpeg 8.1.2): 8/8 PASS — repeat hashes, loudness/true-peak
  tolerance, loop-bound survival through Opus, near-silent and clipped refusals,
  argv-only invocation.
- Baseline: 0 pre-existing test failures observed; 1 pre-existing guard failure
  (`scripts/src/lib/agents/contract_pipeline/orchestrator.ts` exceeds its reviewed
  size ceiling — untouched by this contract). All other guards pass.
- Production path (`/studio/assets`, real Chromium): renders; audio recipes carry
  the typed unavailable reason. Dev sandbox (`/dev/studio-audio`): 240-bucket
  waveform, `aria-pressed` transport transitions, loop bounds announced, keyboard
  toggle, zero page errors.
- Screenshots: `.pi/.screenshots/c521-sandbox-playing.png`,
  `c521-sandbox-audio-review.png`, `c521-studio-assets.png` (gitignored).
  🔴 `ai_validate_image` / `browser screenshot` were not available in this
  session, so the visual assertions above are DOM-level, not model-scored. The
  verifier should re-score the saved captures.
