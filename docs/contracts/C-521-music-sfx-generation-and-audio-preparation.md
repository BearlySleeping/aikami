---
id: C-521
title: "Music and SFX generation with audio preparation"
source: "direct — 2026-09-13 asset generation and Emberwatch review"
contract_type: full
status: draft
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
| **Dependencies** | C-511, C-517–C-519; C-512 for Studio audio review |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | User-facing generation/creating-assets guides; affected Hub help |
| **Contract version** | 1.0.0 |
| **Production Surface** | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` audio review |

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
| `apps/backend/local-stack/stack/models.manifest.json` | pin new complete model sets |
| `apps/backend/local-stack/stack/ace-step.Dockerfile` | follow pinned-build conventions |
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
- Initial profiles: archival lossless master; music/ambient runtime 48 kHz stereo Opus where target browsers decode it, with a proven alternative rendition where required; short positional SFX PCM WAV mono; UI/stereo effects explicitly declared. Hash each rendition separately. Keep the installed catalog's supported extensions authoritative.
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

Local music/SFX production and finishing plus Studio audio review. Excludes voice cloning, new TTS, hosted credentials and authoritative story-state changes.

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: New API is real

**Given** pinned ACE-Step 1.5 readiness and installed models, **when** generate instrumental music through batch and Studio, **then** native task tracking, HTTP artifact retrieval and registry save work; subject is preserved; no browser reads a server path.

### AC-2: SFX are a distinct capability

**Given** eligible installed SFX profile and a gate-slam brief, **when** generate a one-shot and ambience, **then** correct model/profile is used; unsupported configuration is explicit; listening rejects music/vocals in the effect.

### AC-3: Finishing is reproducible

**Given** fixed masters including clipped/silent/truncated fixtures, **when** process each profile twice, **then** valid rendition hashes repeat for pinned tools; invalid clips fail; actual metadata agrees with decoded bytes.

### AC-4: Loops survive delivery

**Given** accepted music and ambience with authored sample bounds, **when** encode, load in supported browsers and play five loops, **then** no audible click/gap, loop points are valid for the decoded rendition, and playback/mute controls work.

### AC-5: Resource/offline behavior

**Given** no GPU, unreachable engine, and a cached accepted track, **when** open Studio and play the pack offline, **then** unavailable generation is explained; playback still works; generation does not block movement/dialogue/combat.

### AC-6: Version rollback

**Given** v1 and v1.5 recipes coexist, **when** switch default profile and revert it, **then** old accepted audio remains playable; v1 preferences still resolve; models never auto-download on game boot.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | adapter CI + live GPU/Studio smoke | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` audio review | Unverified — populate during execution |
| AC-2 | adapter integration + blind listening report | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` audio review | Unverified — populate during execution |
| AC-3 | processor integration | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` audio review | Unverified — populate during execution |
| AC-4 | browser audio journey + listening evidence | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` audio review | Unverified — populate during execution |
| AC-5 | production smoke | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` audio review | Unverified — populate during execution |
| AC-6 | compatibility integration | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` audio review | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted: existing affected tests under local-ai, schemas, frontend storage, client, Hub and scripts as applicable. Determine exact Moon project task names from current moon.yml; do not invent passing task output.
- Functional E2E: Playwright in apps/e2e/tests/client or tests/hub, exercising the production path above. Use compiled Svelte tests for reactivity/lifecycle.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Implement versioned API adapter with recorded protocol fixtures.
2. Pin complete audio model sets and optional SFX profile.
3. Implement deterministic finishing/analysis and scoped retrieval.
4. Wire Studio audio preview and run live generation/loop tests.

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
