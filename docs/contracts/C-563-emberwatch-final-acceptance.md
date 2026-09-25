---
id: C-563
title: "Emberwatch final acceptance review"
source: "direct"
contract_type: thin
status: in_progress
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/403"
created_at: "2026-09-25T17:00:00+02:00"
---

# Contract C-563: Emberwatch final acceptance review

## Metadata

| Field | Value |
|---|---|
| **Source** | Direct request: final human review of all five maps plus UI after C-559/C-561/C-562. |
| **Target** | PR #403 candidate, `.evidence/C-559*`, `.evidence/C-562*`, and human review record. |
| **Type** | thin |
| **Priority** | P0 — release decision boundary. |
| **Dependencies** | C-559 terrain; C-561 props; C-562 five-map adoption; C-558 loaded-content identity. |
| **Status** | in_progress |
| **Promotion** | — |
| **Docs Impact** | internal — final acceptance record. |
| **Contract version** | 2.0.0 |
| **Production Surface** | production `/game` candidate; no promotion. |

## Problem & Baseline Evidence

- C-559 evidence covers terrain/interior/water regressions but crossing human acceptance is still open.
- C-561 evidence covers registry style classes, light/dark/checker prop edges, and footprint records.
- C-562 evidence covers four adopted maps with candidate-origin content identity and 1280×720 captures.
- The current candidate has not received one consolidated human sign-off across the five maps and the UI. VLM scores are diagnostic only.

## User Outcome

A human reviewer can inspect one traceable candidate and approve or reject the complete Emberwatch visual/UI slice without confusing technical evidence gates with aesthetic acceptance.

## Scope Boundaries

- **In Scope:** final evidence index; five-map review checklist; UI review checklist; technical gate summary; explicit human decision; release-blocker list.
- **Out of Scope:** code changes during review, production promotion, deployment, save migration, and treating VLM output as approval.

## Acceptance Criteria

### AC-1: Traceable candidate identity

**Given** the final PR branch
**When** the acceptance packet is assembled
**Then** it records commit, branch, clean/dirty status, generated content manifest SHA-256, atlas/prop origins, viewport policy, and evidence checksums.

**Verification**: inspect `.evidence/` manifests and run `bun run emberwatch:locked-ids` / `bun run emberwatch:validate`.

### AC-2: Five-map human review

**Given** C-559 and C-562 paired evidence
**When** a human reviews village, inn, merchant shop, old road, and ruined shrine at gameplay scale
**Then** each map receives explicit accept/reject notes for terrain, structures, props, navigation readability, and loaded identity; unresolved defects block promotion.

**Verification**: completed review table with reviewer, timestamp, commit, and per-map decision.

### AC-3: UI human review

**Given** the production `/game` candidate with C-554/C-555 UI changes
**When** a human reviews exploration HUD, pause/settings, dialogue, character, inventory, and journal states
**Then** default/alternate theme, compact viewport, keyboard/focus behavior, and 200% text are recorded; no debug/dev control appears in the production build.

**Verification:** production-route screenshots and interaction checklist.

### AC-4: Final gate and handoff

**Given** all technical checks and human review notes
**When** the captain prepares handoff
**Then** passing technical checks, inherited local timeouts, human decisions, and remaining blockers are separated clearly; production promotion remains explicitly unauthorized.

**Verification:** final acceptance report and reviewer decision.

## Edge Cases & Gotchas

- A technically green capture can still be visually rejected; never convert a VLM score into human approval.
- Candidate asset origin, loaded manifest digest, and Git commit must all agree before reviewing a screenshot.
- Any post-review code or content regeneration invalidates the affected evidence lane.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-25 | Initial direct contract; bundled into PR #403. | user |

## Promotion Lifecycle

See [promotion lifecycle](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [status lifecycle](SHARED_SECTIONS.md#status-lifecycle).

---

## Execution Report

### Summary

Final acceptance is waiting for human review. Technical evidence and candidate identity are prepared; no production promotion is authorized.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Candidate manifest and evidence origins are recorded; final branch fingerprint required at handoff. |
| AC-2 | ⚠️ | Five-map technical lanes exist; human decisions pending. |
| AC-3 | ❌ | UI human review pending. |
| AC-4 | ⚠️ | Final gate/report pending. |

### Files Created

| File | Purpose |
|---|---|
| `docs/contracts/C-563-emberwatch-final-acceptance.md` | Final acceptance contract and review record. |

### Files Modified

| File | Change |
|---|---|
| — | None during acceptance phase. |

### Deviations from Spec

None. Production promotion is out of scope.

### Test Results

- Technical: see C-558/C-559/C-561/C-562 execution reports.
- Human visual review: pending.
- Production promotion: not authorized.
