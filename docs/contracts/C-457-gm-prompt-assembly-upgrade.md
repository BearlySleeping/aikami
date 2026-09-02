---
id: C-457
title: "GM Prompt Assembly Upgrade"
source: "docs/contracts/BACKLOG_C452_PLUS.md 'C-462' seed (RPG-depth batch, 2026-08-30 roadmap review). Renumbered on authoring — see C-456's source note for the ID-allocation caveat."
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-02"
---

# Contract C-457: GM Prompt Assembly Upgrade

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/contracts/BACKLOG_C452_PLUS.md` RPG-depth batch, seed "C-462" |
| **Target** | `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts`, `apps/frontend/client/src/lib/services/gm/gm_types.ts` |
| **Type** | full |
| **Priority** | P2 |
| **Dependencies** | [C-456](C-456-group-chat-and-systemic-npc-interactions.md) (shares the `gatherContext()` seam — sequence after or alongside it); should stay in sync with [C-458](C-458-in-house-memory-and-lore-retrieval-system.md) since both touch the same prompt-budget problem from opposite sides |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal (prompt quality, not new UI) |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `assemblePrompt()` in `gm_prompt_service.svelte.ts` joins every section unconditionally (world state, player character, quests, NPCs, party, combat, system instructions, lorebook world info, CYOA history, bridge context) into one string, then measures the result with `TextEncoder` and — if it exceeds 6144 bytes — only **logs a warning**. Nothing is dropped, truncated, or prioritized. The file's own header comment claims the output "is guaranteed to be under 6 KB," which is currently false: there is no enforcement path, only observability.
- **Reproduction**: assemble a prompt with several active quests, a full party, nearby NPCs, and multiple lorebook matches — the byte count can exceed 6144 with only a console warning, no behavior change downstream (the full oversized prompt still goes to the LLM).
- **Existing implementation to reuse**: the existing section-assembly pipeline (`gatherContext()` → typed context → `assemblePrompt()`) and address-mode gating (`AddressMode`, C-235) — the ordering and section boundaries are sound and should be kept, not rebuilt. `lorebookStore.scanActiveEntries()`'s own token-budget pattern (warn at 2048 bytes, hard cap at 5120 bytes, drop excess matches) is a working precedent for real enforcement, in the same codebase, one layer down — mirror that pattern at the prompt-assembly level instead of inventing a new budgeting mechanism.
- **Known gaps**: no per-section priority — if the budget were enforced today by simple truncation, `[SYSTEM INSTRUCTIONS]` could be cut before `[WORLD INFO]`, which is backwards. `playerCharacter`/`locationName`/`locationDescription` in `gatherContext()` are hardcoded placeholders (`'Hero'`, `'Town Square'`) with unresolved `// TODO: wire to actual X system` comments — any budget work done before these are wired would be tuning against fake data.
- **Baseline tests**: `gm_prompt_service.test.ts` — extend with byte-budget assertions; none exist today.

## User Outcome

After this contract, a player's GM prompt reliably fits the model's effective context regardless of scene complexity (large party, many active quests, many lorebook matches) — lower-priority context is dropped first, and the model never silently receives an unbounded prompt.

## Success Measures

- **Time/latency target**: budget enforcement adds negligible overhead (string-length arithmetic, no extra LLM calls).
- **Offline/degraded behavior**: enforcement must work identically for the local/offline AI engine as for BYOK/service modes — the budget is a prompt-shape concern, not provider-specific.
- **Production journey enabled**: a player with a full party, an active questline, and a rich lorebook can play an extended session without prompt bloat degrading response quality or exceeding the model's context window.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Section assembly pipeline | `gm_prompt_service.svelte.ts` `gatherContext()`/`assemblePrompt()` | reuse structure — modify to add priority/truncation |
| Byte-budget warning | `gm_prompt_service.svelte.ts` (6144-byte `TextEncoder` check) | modify — from warn-only to enforced |
| Token-budget-with-drop precedent | `lorebook_store.svelte.ts` `scanActiveEntries()` (2048 warn / 5120 cap, drop excess by priority) | reuse pattern — mirror at the prompt level |
| Address-mode section gating | `AddressMode` (C-235) | reuse as-is |

## Overview

Turn the existing 6KB tripwire into a real, priority-ordered budget: rank sections by importance (system instructions and current turn context outweigh background lore and history), truncate or drop lowest-priority sections first when the assembled prompt would exceed budget, and finish wiring the placeholder context fields (`playerCharacter`, `locationName`, `locationDescription`) so budget tuning happens against real data.

## Design Reference

Mirror `lorebook_store.svelte.ts`'s existing warn-then-cap-then-drop pattern rather than introducing a new budgeting abstraction. Keep `assemblePrompt()`'s existing section order as the default priority signal (earlier sections = higher priority) unless a section-specific override is warranted (see State & Data Models).

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Assign each assembled section a priority tier; `[SYSTEM INSTRUCTIONS]` (including the `[GM ONLY]` sub-block) and the current player message are always-included (never dropped); `[WORLD INFO]` (lorebook), `[NEARBY NPCS]`, `[PARTY MEMBERS]`, and CYOA history are droppable in that relative order when over budget.
- Replace the warn-only `TextEncoder` check with real enforcement: measure cumulative bytes as sections are assembled, stop including lower-priority sections once the 6144-byte cap would be exceeded, log which sections were dropped (for observability, not silently).
- Wire `gatherContext()`'s placeholder fields (`playerCharacter`, `locationName`, `locationDescription`) to their real backing services rather than hardcoded strings — this is a prerequisite for meaningful budget tuning, not optional cleanup.
- Do not change section *order* or the address-mode gating logic (C-235) — this contract is additive (budget enforcement), not a rewrite of assembly structure.

## State & Data Models

```typescript
// apps/frontend/client/src/lib/services/gm/gm_types.ts
type PromptSectionPriority = "required" | "high" | "medium" | "low";

type PromptSection = {
  name: string; // e.g. "WORLD INFO", "PARTY MEMBERS"
  content: string;
  priority: PromptSectionPriority;
};
```

No `packages/shared` schema changes — stays client-local per `gm_types.ts`'s existing GM-context boundary decision.

## Quality Requirements

- **Offline/degraded mode**: budget enforcement runs identically offline; no network dependency introduced.
- **Accessibility/input**: N/A.
- **Performance budget**: enforcement itself must be O(sections), no measurable added latency to prompt assembly.
- **Security/privacy**: N/A.
- **Persistence/migration**: N/A — no persistent state changes.
- **Cancellation/retry/idempotency**: N/A — pure synchronous assembly step.
- **Observability**: log dropped sections per assembly (section name + byte count) so drift/regressions in what gets cut are visible, not silent.

## Migration & Rollback

N/A — no persistent state changes. Rollback is reverting to the warn-only check; no data migration involved.

## Scope Boundaries

- **In Scope:** priority-tiered budget enforcement in `assemblePrompt()`; wiring `gatherContext()`'s placeholder fields to real services; observability for dropped sections.
- **Out of Scope:** retrieval/semantic memory (that's [C-458](C-458-in-house-memory-and-lore-retrieval-system.md) — this contract only bounds what's already gathered, it doesn't change *what* is gathered); nearby-NPC/party-member data wiring (that's [C-456](C-456-group-chat-and-systemic-npc-interactions.md)); raising or lowering the 6144-byte cap itself (keep the existing number unless evidence from this work says otherwise — flag as an Open Question, don't silently change it).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Single contract — budget enforcement and placeholder-field wiring are both prerequisites for the same acceptance criteria (a real, tunable budget) and share the same `gatherContext()`/`assemblePrompt()` touch point.

## Acceptance Criteria

### AC-1: Oversized prompts are truncated, not just warned about
**Given** a scene assembling enough sections to exceed 6144 bytes
**When** `assemblePrompt()` runs
**Then** the returned prompt is at or under 6144 bytes, with lowest-priority sections dropped first

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `gm_prompt_service.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: construct a context with an oversized lorebook match set and full party, assert output length and dropped-section log
- E2E / Visual: N/A

**Watch Points**:
- `[SYSTEM INSTRUCTIONS]` and the current player message must never be among the dropped sections, even in worst-case oversized scenes.

### AC-2: Placeholder context fields resolve to real data
**Given** an active campaign with a named player character and current location
**When** `gatherContext()` runs
**Then** `playerCharacter`, `locationName`, and `locationDescription` reflect real campaign state, not `'Hero'`/`'Town Square'` placeholders

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Integration | `gm_prompt_service.test.ts` | `/game` any active campaign | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: dev sandbox campaign with a custom character name/location, inspect assembled prompt
- E2E / Visual: N/A

**Watch Points**:
- Confirm no regression for campaigns mid-transition (location not yet resolved) — fall back gracefully, don't throw.

### AC-3: Dropped sections are observable
**Given** a truncated prompt (AC-1 scenario)
**When** assembly completes
**Then** a log entry records which section(s) were dropped and their byte size

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `gm_prompt_service.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: same oversized-context test as AC-1, assert log call
- E2E / Visual: N/A

**Watch Points**:
- Use the existing logger convention (`this.warn(...)`) already present in the file — don't introduce a new logging pattern.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: wire `gatherContext()`'s placeholder fields to real services; define section priority tiers.
2. **Phase 2 (Integration)**: replace the warn-only byte check with enforced truncation/dropping in `assemblePrompt()`, add drop logging.
3. **Phase 3 (Validation)**: run `bun run validate`, `moon run client:test`, and manually verify a deliberately oversized dev-sandbox scene produces a bounded, well-formed prompt.

## Edge Cases & Gotchas

- **Every section dropped down to `required` still exceeds 6144 bytes**: define the floor behavior — truncate the `[SYSTEM INSTRUCTIONS]` content itself as a last resort, or accept exceeding the cap and log loudly. Resolve as an Open Question, don't guess silently.
- **Address-mode-specific sections** (`[PARTY MEMBERS]` in party mode) being dropped changes the address-mode contract from C-235 — make sure dropping is visible in tests that assert address-mode behavior so it isn't mistaken for a C-456 regression.

## Open Questions

Must be resolved before status becomes `approved`:

- What happens when even `required`-tier sections alone exceed 6144 bytes — truncate system instructions, raise the cap, or accept overflow with a loud log?
- Should the 6144-byte cap itself be reconsidered now that real budget tuning is possible, or kept as-is pending evidence from production usage?

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
