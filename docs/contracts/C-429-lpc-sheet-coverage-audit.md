---
id: C-429
title: "LPC Sheet Coverage Audit — Direction and Geometry Gate"
source: "user request 2026-08-23 — engine review; missing-direction defect found by hand"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-23"
---

# Contract C-429: LPC Sheet Coverage Audit — Direction and Geometry Gate

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-23). The defect class this gate catches was found by hand during an engine review and had shipped undetected past the existing visual suite. |
| **Target** | `scripts/src/lib/ops/` (new audit script), `apps/frontend/client/static/game-data/` (committed baseline), CI wiring |
| **Priority** | P1 — cheap, and it is what makes C-431's completion objectively measurable rather than a claim. |
| **Dependencies** | C-428 (shares the geometry definition — the audit imports the same resolver). Can be drafted in parallel, must merge after. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal → developer note on running the audit |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: nothing validates that a collected LPC sheet actually
  contains the frames the renderer will ask it for. A sheet can ship with three
  of its four direction rows fully transparent and every existing check passes:
  the file exists, the manifest lists it, the hash matches, it converts to WebP
  cleanly, and it loads without error. The character simply renders with the
  layer invisible in those directions.

- **Reproduction** — this is live in `main` today:
  ```bash
  # Count non-empty cells per direction row in a shipped sword walk sheet.
  # Rows are LPC order: 0=up, 1=left, 2=down, 3=right.
  for r in 0 1 2 3; do n=0; for c in $(seq 0 8); do
    magick apps/frontend/client/static/game-data/lpc/weapon/sword/longsword.walk.webp \
      -crop 64x64+$((c*64))+$((r*64)) +repage -trim info: 2>&1 | grep -q " 1x1 " || n=$((n+1));
  done; echo "row $r: $n frames"; done
  # → row 0: 0    row 1: 0    row 2: 9    row 3: 0
  ```
  Confirmed identically for `katana.walk.webp`, `scimitar.walk.webp`,
  `longsword_alt.walk.webp` and `saber.walk.webp`. Walking with any of these
  equipped, the weapon is invisible in three of four directions. (The cause and
  fix are C-431; this contract makes the gap *measurable*.)

- **Existing implementation to reuse**:
  - `scripts/src/lib/ops/collect_lpc_assets.ts` already walks the generator
    tree and knows the slot/state/variant taxonomy — reuse its path parsing.
  - `apps/frontend/client/static/game-data/asset_hashes.json` already carries
    a sha256 + `sizeBytes` per tag, so the audit can key its baseline by content
    hash and skip unchanged files.
  - `scripts/src/lib/ops/validate_lpc_visuals.ts` is the precedent for a
    report-emitting ops script (JSON report + HTML view + checksum cache).
    Follow its shape; do **not** extend it — that script is a VLM grader, this
    is a deterministic byte-level check.
  - The C-428 geometry resolver supplies the pitch/columns/rows for slicing.

- **Known gaps**: `validate_lpc_visuals.ts` screenshots the `/dev/lpc` route and
  grades with a VLM at a 70/100 pass threshold. It did not catch a layer missing
  in three of four directions, because the suite's cases do not systematically
  sweep direction and a soft confidence score does not fail on an absent layer.
  A deterministic check is required; an LLM grader is not a substitute for one.

- **Baseline tests**: `bun moon run scripts:test`. Must pass before starting.

## User Outcome

After this contract, a **developer** who changes the LPC collection pipeline
gets a deterministic, named list of every sheet whose frames do not cover what
the renderer will request — in CI, before merge — instead of discovering it as
an invisible sword months later.

## Success Measures

- **Time/latency target**: a full audit of ~12,700 sheets completes in under
  5 minutes cold, and under 30 seconds warm (unchanged files skipped by hash).
- **Offline/degraded behavior**: fully offline. Reads local files only, no
  network, no API key, no model.
- **Production journey enabled**: makes C-431's acceptance objectively
  checkable — "the behind pass is collected" becomes a number that moves, not
  an assertion.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Generator tree walk + taxonomy | `scripts/src/lib/ops/collect_lpc_assets.ts` | reuse — import its path parsing |
| Per-asset hash + size sidecar | `apps/frontend/client/static/game-data/asset_hashes.json` | reuse — baseline cache key |
| Ops-script report shape (JSON + HTML + cache) | `scripts/src/lib/ops/validate_lpc_visuals.ts` | reuse as a style reference only |
| Sheet geometry (pitch/columns/rows) | C-428 shared resolver in `@aikami/frontend/engine` | reuse unchanged |

## Overview

Add a deterministic audit that slices every collected LPC sheet on its resolved
cell grid, records which direction rows and frame columns actually contain
pixels, and compares the result against a committed baseline. New gaps fail CI;
known gaps are listed in the baseline and shrink as C-431 lands.

## Design Reference

`scripts/src/lib/ops/validate_lpc_visuals.ts` for the ops-script idiom (arg
parsing, checksum cache, JSON report + HTML view, non-zero exit on failure).
Follow `scripts/src/lib/ops/` conventions for a Bun CLI entry point. ImageMagick
is already a declared prerequisite of the LPC pipeline — reuse it rather than
adding an image-decoding dependency.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Deterministic, not probabilistic.** Byte-level alpha inspection only. No
  model, no API key, no network, no score threshold. A frame either has pixels
  or it does not.
- **Baseline-diffed, not absolute.** A hard gate would fail CI on day one
  against ~12,700 known-imperfect sheets and be disabled within a week. The
  audit fails only on **regressions against a committed baseline file**, and on
  entries whose gap has *widened*. Closing a gap requires updating the baseline
  in the same PR, which makes progress visible in review.
- **Complementary layers are not gaps.** A `_bg` sheet legitimately covers only
  the directions where the item is occluded (`shield/crusader_bg.walk.webp`
  correctly has only the up row). The audit evaluates an fg/bg **pair's union**
  against full coverage, not each sheet in isolation. Pairing rule is declared
  in the baseline, not inferred from filenames alone.
- **Name every failure.** "47 sheets failed" is not actionable at this scale.
  Report the asset tag, the missing rows, and the resolved geometry for each.
- **Read-only.** The audit never rewrites assets, the manifest, or the catalog.

## State & Data Models

Baseline + report — committed under `apps/frontend/client/static/game-data/`:

```ts
/** Which direction rows carry pixels, plus the frame count per populated row. */
type LpcSheetCoverage = {
  /** Manifest tag, e.g. "lpc:weapon:sword:longsword:walk". */
  tag: string;
  /** Resolved geometry from the C-428 resolver. */
  pitch: number;
  columns: number;
  rows: number;
  /** Non-empty frame count per direction row, index = LPC row (0=up,1=left,2=down,3=right). */
  framesPerRow: readonly number[];
};

/** One accepted, known-incomplete sheet or pair. */
type LpcCoverageBaselineEntry = {
  tag: string;
  /** Tag of the complementary bg/fg sheet whose union completes coverage, when one exists. */
  pairedWith?: string;
  /** Direction rows known to be empty and accepted for now. */
  acceptedEmptyRows: readonly number[];
  /** Why this gap is accepted, and the contract that will close it. */
  reason: string;
};

/** The committed baseline document. */
type LpcCoverageBaseline = {
  schemaVersion: 1;
  generatedAt: string;
  /** Total sheets audited when this baseline was written. */
  auditedCount: number;
  entries: readonly LpcCoverageBaselineEntry[];
};
```

No TypeBox schema required — these are build-time ops artifacts, never loaded
by the client or validated at runtime.

## Quality Requirements

- **Offline/degraded mode**: fully offline by construction.
- **Accessibility/input**: N/A — CLI only.
- **Performance budget**: see Success Measures. Parallelise cell inspection;
  a serial `magick` invocation per cell over 12,700 sheets will not meet it.
- **Security/privacy**: N/A — local files only, no credentials, no network.
- **Persistence/migration**: the baseline file is committed and versioned with
  `schemaVersion: 1`. An unreadable or absent baseline is a hard failure with a
  clear message, never a silent pass.
- **Cancellation/retry/idempotency**: pure and idempotent — same inputs, same
  report. Interruption loses only cache warmth.
- **Observability**: report audited / passed / regressed / newly-covered counts,
  elapsed time, and every failing tag by name. Non-zero exit on any regression.

## Migration & Rollback

N/A — no persistent runtime state. The baseline file is a new build artifact;
`git revert` removes the script, the baseline, and the CI step together.

## Scope Boundaries

- **In Scope:**
  - New audit script under `scripts/src/lib/ops/`.
  - The committed baseline file and its first generation.
  - Moon task + CI wiring so it runs on changes to the LPC pipeline or assets.
  - Unit tests over the coverage/diff logic using small synthetic sheets.
  - A short developer note on running it and updating the baseline.
- **Out of Scope:**
  - **Fixing any of the gaps it finds** — that is C-431. This contract's first
    baseline is expected to be large; that is the correct outcome, not a failure.
  - Changing `collect_lpc_assets.ts` collection behaviour.
  - Replacing, modifying or deleting `validate_lpc_visuals.ts`. The two coexist:
    deterministic coverage here, perceptual quality there.
  - Auditing non-LPC categories (music, maps, tilesets).
  - Any client or engine runtime change.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. A gate without a baseline cannot run, and a
baseline without a gate is an unread file. Neither half is independently useful.

## Acceptance Criteria

### AC-1: The audit reports per-row frame coverage for every collected sheet
**Given** the collected LPC asset tree
**When** the audit runs
**Then** it emits a report containing one `LpcSheetCoverage` record per sheet, with `framesPerRow` counts derived from actual pixel data on the sheet's resolved cell grid

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `scripts/src/lib/ops/__tests__/*.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: run the audit against the real tree; confirm `longsword.walk` reports `framesPerRow: [0, 0, 9, 0]`.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- Use the C-428 resolver for the grid. Auditing a 128px sheet on a 64px grid reproduces the very bug this is meant to catch.
- "Non-empty" must mean *any* non-zero alpha, not a colour heuristic.

### AC-2: A new coverage gap fails the audit
**Given** a committed baseline in which a sheet has full four-row coverage
**When** that sheet is replaced by one missing its left row and the audit runs
**Then** the audit exits non-zero and names the tag and the newly-empty row

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `scripts/src/lib/ops/__tests__/*.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: N/A — synthetic sheets in the unit test cover this deterministically.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- The failure message must name the tag and rows. A bare count is an automatic fail on this AC.

### AC-3: A baselined gap does not fail the audit
**Given** a committed baseline listing `lpc:weapon:sword:longsword:walk` with `acceptedEmptyRows: [0, 1, 3]`
**When** the audit runs against the current asset tree
**Then** it exits zero and classifies that sheet as a known gap rather than a regression

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `scripts/src/lib/ops/__tests__/*.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: run against the real tree with the generated baseline; expect exit 0.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- Every baseline entry needs a non-empty `reason` naming the contract that will close it. Reject a baseline that accepts gaps without attribution.

### AC-4: Complementary bg/fg pairs are evaluated as a union
**Given** `shield/crusader_bg.walk` covering only the up row and `shield/crusader_fg.walk` covering all four, declared as a pair in the baseline
**When** the audit runs
**Then** neither sheet is reported as a gap, because their union covers all four directions

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `scripts/src/lib/ops/__tests__/*.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: run against the real tree; confirm the `crusader` shield pair is clean while `longsword` is a known gap.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- Do not infer pairing from an `_bg`/`_fg` filename suffix alone — the sword family uses a `universal_behind/` directory instead (C-431). Pairing is declared data.
- A bg sheet covering a direction its fg partner *also* covers is legal (both layers drawn) and is not an error.

### AC-5: The audit runs in CI on LPC pipeline or asset changes
**Given** a change to `scripts/src/lib/ops/collect_lpc_assets.ts` or to files under `static/game-data/lpc/`
**When** CI runs
**Then** the audit executes and its exit status gates the build

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | Moon task definition + `.github/workflows/` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: the new audit task must be reachable from `moon ci`.
- Integration: confirm the task's `inputs` cover the collector and the LPC asset tree so Moon does not cache past a real change.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- Getting Moon's `inputs` wrong makes the gate silently never run. Verify by touching an asset and confirming the task is not cached.
- Ensure CI has ImageMagick available before making the task blocking.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Build the coverage scanner and the baseline diff with synthetic-sheet unit tests (AC-1 to AC-4).
2. **Phase 2 (Integration)**: Generate the first baseline against the real tree, commit it, and add the Moon task + CI wiring (AC-5).
3. **Phase 3 (Validation)**: `bun moon run scripts:test`, then a full audit run; confirm it exits zero with the committed baseline and non-zero when a row is artificially blanked.

## Edge Cases & Gotchas

- **Single-row state sheets.** Hurt and some idle sheets are one row by design. `rows: 1` from the resolver means "not a four-direction sheet" — do not report three missing rows.
- **Oversize sheets have blank trailing columns.** A 13-column oversize walk sheet uses columns 0–8. Judge coverage against the animation state's frame count, not the sheet's column count.
- **Cost of naive slicing.** One `magick` process per cell is ~12,700 × 36 invocations. Read each sheet once and inspect its alpha channel in-process, or batch per sheet.
- **The first baseline will be large.** That is the point. Do not shrink it by loosening the check.
- **WebP alpha.** Ensure the decode preserves the alpha channel; a decoder that flattens onto opaque black reports every cell as populated and the audit silently passes everything.
- **Do not gate on `validate_lpc_visuals.ts`.** It needs `OPENROUTER_API_KEY` and makes network calls. This audit must stay runnable with no secrets.

## Open Questions

Must be resolved before status becomes `approved`:

- None.

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
