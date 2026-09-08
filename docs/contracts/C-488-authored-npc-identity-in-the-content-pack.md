---
id: C-488
title: "Authored NPC identity in the content pack"
source: direct
contract_type: full
status: draft
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-07T00:00:00Z"
---

# Contract C-488: Authored NPC identity in the content pack

## Metadata

| Field | Value |
|---|---|
| **Source** | [`BACKLOG_C485_PLUS.md`](BACKLOG_C485_PLUS.md) § C-488, seeded from the 2026-09-06 external review; verified findings V-3 and V-4 |
| **Target** | `packages/shared/schemas/src/lib/game/content_pack.ts` (`ContentPackNpcEntrySchema` `:87-132`), `packages/shared/types/`, `content/packs/emberwatch/manifest.json`, the pack loader (C-315), `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` (`:1280-1285` persona build, `:1615` intent persona), `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts` |
| **Type** | full |
| **Priority** | P0 — "a name plus 'fantasy NPC' is not a character"; blocks C-493/C-494/C-495 |
| **Dependencies** | None |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | user-facing — the pack authoring format gains identity fields |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — the production NPC dialogue path that assembles the persona |

## Problem & Baseline Evidence

- **Current behavior — one-line persona (V-3)**: the production dialogue path builds a persona of "You are <NPC name>, a character in a fantasy world." at `npc_dialogue_service.svelte.ts:1615` (intent envelope) and the slightly richer "You are <NPC name>, a <npc.name> living in a fantasy world." plus a `PERSONA_PROMPTS` fallback at `:1280-1285` (context projection). In both cases the only authored input is the NPC's `name`; everything else is a generic fallback.
- **Current behavior — empty pack NPCs (V-4)**: `ContentPackNpcEntrySchema` (`content_pack.ts:87-132`) gives an NPC `name`, `defaultDialogueKey`, `appearanceLayers`, `isVendor`, `vendorInventory`, `combatStats`, `initialSuggestions`, and companion fields (C-340). There is no personality, agenda, knowledge, secrets, or boundaries. The Emberwatch manifest confirms it — each of the three NPCs (`village_elder` "Elder Thalia", `rollo_grasper` "Rollo the Grasper", `merchant` "Mara the Merchant") carries only name/defaultDialogueKey/appearanceLayers/vendor fields.
- **The richer brain exists and is not used**: `gm_prompt_service.svelte.ts` (C-235, C-457) assembles a far richer GM context; the interaction players actually reach does not consume it. This contract reuses that assembler's *pattern*, not its ownership.
- **Correction written in so the implementer does not "fix" a non-bug**: the intent prompt **does** already receive recent conversation and game-state facts via `buildGameStateFacts()`, including relationship and faction facts. The gap is the **persona/agenda/knowledge definition**, and the fact that the roll-resolution prompt does not receive those same facts.
- **Reproduction**: `grep -n "fantasy world" apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts`, then read `content/packs/emberwatch/manifest.json` NPC entries.
- **Existing implementation to reuse**: `ContentPackNpcEntrySchema` (extend, don't replace); `buildGameStateFacts()` / `buildGameStateFacts({ npcId })` (already feeds the intent prompt); the pack loader's version/migration path (C-315).
- **Known gaps**: no authored identity fields; the roll-resolution prompt (`resolveRoll`) does not receive the conversation/game-state facts the intent prompt gets; no budget measurement exists for the assembled prompt.
- **Baseline tests**: `packages/shared/schemas/src/lib/game/content_pack.test.ts`, the pack-loader tests, `npc_dialogue_service.test.ts`. Run them before starting; record prompt token counts on the three Emberwatch NPCs.

## User Outcome

After this contract, a pack author can give an NPC a voice, a want, knowledge they will share, secrets they will not volunteer, and lines they will not cross — and a player talking to that NPC meets those traits in the production dialogue path, not a name floating in a generic fantasy shell.

## Success Measures

- **Time/latency target**: persona assembly stays O(1) — no new network calls; the only cost is prompt-token count, which is capped (AC-6).
- **Offline/degraded behavior**: a pack authored against the previous schema still loads; missing identity fields degrade to the current generic behaviour (a test proves it).
- **Production journey enabled**: `/game` → talk to an Emberwatch NPC → the assembled persona contains that NPC's authored identity.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Pack NPC schema + TypeBox validation | `packages/shared/schemas/src/lib/game/content_pack.ts` `ContentPackNpcEntrySchema` | modify — add optional identity fields |
| Derived runtime types | `packages/shared/types/` | modify — mirror the new fields |
| Persona assembly (context projection + intent envelope) | `npc_dialogue_service.svelte.ts:1280-1285`, `:1615` | modify — assemble from authored identity, not name-only |
| Richer GM context assembly | `gm_prompt_service.svelte.ts` | reuse the *pattern*; do not merge services |
| Game-state facts | `buildGameStateFacts()` | reuse — and extend to the roll-resolution prompt |
| Pack loader version/migration | C-315 | modify — document the v3.x→v4 migration |

## Overview

The content pack gains five optional NPC identity fields — `personality`, `agenda`, `knowledge`, `secrets`, `boundaries` — in TypeBox, with derived types in `@aikami/types`. The production dialogue path assembles its persona from those fields when present and degrades to today's generic behaviour when absent. The same conversation/game-state facts the intent prompt already receives are also given to the roll-resolution prompt. The three Emberwatch NPCs each get an authored identity with at least one conflicting agenda. All of this stays inside the existing prompt budget — identity displaces filler, it does not extend the ceiling.

## Design Reference

- `ContentPackNpcEntrySchema` (`content_pack.ts:87-132`) — the field style to match: optional TypeBox fields with `description`, `additionalProperties: false` at the object level.
- `gm_prompt_service.svelte.ts` — the established rich-context assembly shape; the new fields are the *content* that fills the same shape.
- `buildGameStateFacts({ npcId })` in `game_state_facts.ts` — the fact provider already called by the intent path; the roll-resolution prompt must receive the same facts.
- C-315 pack loader — the version-bump and migration precedent a schema change like this must follow.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

Extend `ContentPackNpcEntrySchema` with five **optional** fields, all TypeBox, all `additionalProperties: false` at the object level, all mirrored as derived types in `@aikami/types`:
- `personality` — voice and manner (string or short structured object; state which in the schema).
- `agenda` — what they want, including what they want that conflicts with someone else's want.
- `knowledge` — facts they know and can share.
- `secrets` — facts they know and will not volunteer.
- `boundaries` — what they will not do.

Do **not** merge `npcDialogueService` into `gmPromptService`, or vice versa. Reuse the assembler pattern; service ownership stays as it is.

The production persona assembly reads authored identity from the loaded pack NPC and falls back to the current generic behaviour only for fields that are absent. The roll-resolution prompt (`resolveRoll` → `_resolveRoll`) receives the same conversation history and game-state facts the intent prompt receives.

## State & Data Models

Schema shape to add to `ContentPackNpcEntrySchema` (TypeBox, all `Type.Optional`):

```ts
personality?: { voice: string; manner: string };
agenda?: string[];       // each entry a concrete want; at least one may conflict
knowledge?: string[];    // facts they can share
secrets?: string[];      // facts they will not volunteer
boundaries?: string[];   // lines they will not cross
```

The exact leaf shape is the implementer's choice, but it must be TypeBox in `packages/shared/schemas/` with derived types in `packages/shared/types/`, and it must degrade gracefully when absent. Pack version bumps and the loader migration path are documented in Migration & Rollback.

## Quality Requirements

- **Offline/degraded mode**: a v3.x pack loads unchanged; missing identity degrades to the current generic persona (test-proven).
- **Accessibility/input**: N/A — no new UI in this contract.
- **Performance budget**: persona assembly must not increase the prompt token ceiling; measure before/after token counts on all three Emberwatch NPCs and record them in the Execution Report.
- **Security/privacy**: imported prose must **not** automatically confer permission to alter world state — note this in the contract; the character-card importer itself is out of scope.
- **Persistence/migration**: see Migration & Rollback.
- **Cancellation/retry/idempotency**: persona assembly is pure; re-running produces identical output.
- **Observability**: log when a pack NPC is missing identity fields and the generic fallback is used.

## Migration & Rollback

- **Old data compatibility**: a pack authored against v3.2.0 still loads. Missing fields degrade to current generic behaviour — proven by a test that loads a fixture with no identity fields and asserts the assembled persona is the current generic one.
- **Migration**: bump the Emberwatch pack version (v3.2.0 → v4.0.0) and document the loader's migration path (C-315). No data rewrite is required for existing saves — NPC identity is authored content, not campaign state.
- **Rollback**: revert the schema/types/manifest/persona-assembly changes. Packs authored with identity fields would then simply ignore them again (they are optional).
- **Feature flag or kill switch**: N/A — the fallback path is the kill switch.
- **Failure recovery**: N/A — no partial state.

## Scope Boundaries

- **In Scope:** extending `ContentPackNpcEntrySchema` with the five optional identity fields and mirroring them in `@aikami/types`; assembling the production dialogue persona from authored identity with per-field fallback; passing conversation + game-state facts to the roll-resolution prompt; authoring identities for all three Emberwatch NPCs with at least one conflicting agenda; measuring and capping prompt budget.
- **Out of Scope:** merging `npcDialogueService` into `gmPromptService` (reuse the assembler, do not restructure ownership); memory retrieval feeding the persona (C-492); writing the actual Emberwatch dilemma content (C-495 owns the story — this contract only requires that the fields exist and are populated); the character-card import mapping (note the permission rule, build nothing).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** schema, loader, persona assembly and the three authored NPCs are one outcome — identity fields nobody assembles, or an assembler with no authored content, are each useless alone. The C-495 story writing is already split out by the backlog.

## Acceptance Criteria

### AC-1: The pack NPC schema carries authored identity
**Given** `ContentPackNpcEntrySchema`
**When** extended
**Then** it carries at minimum `personality` (voice and manner), `agenda` (what they want, including what conflicts with another's want), `knowledge` (facts they can share), `secrets` (facts they will not volunteer), and `boundaries` (what they will not do) — all optional, all TypeBox in `packages/shared/schemas/`, with derived types in `packages/shared/types/`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/schemas/src/lib/game/content_pack.test.ts` | `ContentPackNpcEntrySchema` — the production pack schema consumed by the loader | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run schemas:test`
- Integration: a fixture with all five fields validates; a fixture missing them also validates (they are optional).
- E2E / Visual:
    - **Functional**: N/A — schema-level.
    - **Visual**: N/A.

**Watch Points**:
- `additionalProperties: false` must remain at the object level; unknown identity keys are rejected, not silently dropped.
- Do not make the fields required — required fields would break every existing pack and violate AC-2.

### AC-2: A previous-version pack still loads
**Given** a pack authored against v3.2.0 (no identity fields)
**When** it is loaded
**Then** it still loads, missing fields degrade to the current generic behaviour, and a test proves it. The pack version bump and loader migration path are documented.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | pack-loader test + a v3.2.0 fixture | the pack loader (C-315) — the production load path for `content/packs/**` | Filled during verification |

**Test Hooks**:
- Moon Task: the schemas and client loader test tasks
- Integration: load the v3.2.0 Emberwatch fixture (from git history or a committed fixture) and assert no identity fields, no crash.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- Degradation is per-field: an NPC with `agenda` but no `secrets` gets the generic behaviour only for `secrets`, not a wholesale generic fallback.

### AC-3: The production dialogue path uses the authored identity
**Given** an NPC with an authored identity
**When** the player talks to them in the production dialogue path
**Then** the assembled persona contains that identity — asserted by a test on the **production** dialogue path, not the sandbox.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + E2E | `npc_dialogue_service.test.ts`; a `/game` dialogue assertion | `/game` — production `npcDialogueService` persona assembly | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test and E2E tasks
- Integration: assert the assembled persona string for an Emberwatch NPC contains its authored `personality` and `agenda` content.
- E2E / Visual:
    - **Functional**: `/game` journey via `game_page.ts` — talk to an Emberwatch NPC and observe identity-driven dialogue.
    - **Visual**: N/A.

**Watch Points**:
- Test the production `_buildContextProjection` / `_analyzeIntent` path — not a copied assembler in the test, and not the dev sandbox.

### AC-4: The roll-resolution prompt receives the same facts
**Given** the roll-resolution prompt
**When** it is built
**Then** it receives the same conversation history and game-state facts the intent prompt receives.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `npc_dialogue_service.test.ts` | `resolveRoll` — the production roll-resolution path | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: assert the prompt built for `resolveRoll` contains the `gameStateFacts` and recent history that `analyzeIntent` receives.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- The gap is in `resolveRoll`, not `analyzeIntent` — do not "fix" the intent prompt, which already receives facts.

### AC-5: All three Emberwatch NPCs have authored identity
**Given** the Emberwatch pack
**When** it ships
**Then** each of the three NPCs (`village_elder` "Elder Thalia", `rollo_grasper` "Rollo the Grasper", `merchant` "Mara the Merchant") has an authored identity with at least one agenda that conflicts with another NPC's.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `content_pack.test.ts` (manifest-content assertion) | `content/packs/emberwatch/manifest.json` — the shipped pack consumed by `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run schemas:test`
- Integration: read the manifest and assert three NPC identities exist and at least one pair of agendas conflicts.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- This is field population, not the C-495 story. Placeholder identity content is acceptable only if clearly marked for replacement; the conflict must still be real enough to satisfy the AC.
- Do not make each NPC independently invent contradictory truths — the authored identity is static content, not per-turn generation.

### AC-6: Identity fits within the existing prompt budget
**Given** the prompt budget
**When** identity is added
**Then** assembly stays within the existing budget — identity displaces filler, it does not extend the ceiling.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | a budget assertion in `npc_dialogue_service.test.ts` | `_buildContextProjection` — the production assembly whose output feeds the model | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: record before/after token counts for the three Emberwatch NPCs' assembled prompts and assert the after count does not exceed the established ceiling; report both numbers in the Execution Report.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- **This is the trap.** The obvious implementation stuffs five new fields into every prompt and blows the budget, degrading every NPC to make three better. Identity must displace the generic fallback filler, not be concatenated onto it.
- The Execution Report must contain a measured before/after token count — an assertion alone is not enough.

## Implementation Sequence

1. **Phase 1 (Schema + types)**: add the five optional identity fields to `ContentPackNpcEntrySchema` and mirror them in `@aikami/types`; add validation fixtures (AC-1, AC-2).
2. **Phase 2 (Loader + fixture)**: bump the Emberwatch pack version, document the migration, and commit a v3.2.0 fixture proving old packs load (AC-2).
3. **Phase 3 (Persona assembly)**: assemble the production persona from authored identity with per-field fallback; extend facts to `resolveRoll` (AC-3, AC-4).
4. **Phase 4 (Content)**: author identities for the three Emberwatch NPCs with a real conflict (AC-5).
5. **Phase 5 (Budget)**: measure before/after token counts, cap the budget, and record both in the Execution Report (AC-6). Run `validate()`.

## Edge Cases & Gotchas

- **Partially authored NPC**: identity fields are independent; a missing field degrades alone.
- **Roll-resolution prompt parity**: `resolveRoll` must receive facts without re-deriving them twice; build the facts once and share them.
- **Long agendas**: an unbounded `agenda[]` can silently blow the budget. Cap the assembled identity to the same ceiling as today's prompt (AC-6), truncating least-relevant entries first.
- **Generic fallback as a signal**: when identity is absent, the current generic persona remains — and a log line records that a generic NPC was served, so missing content is visible in production.

## Open Questions

- Resolved: the leaf shape of `personality` (`{ voice, manner }` vs. a single string) is left to the implementer but must be TypeBox + derived types and degrade when absent.
- Resolved: do not merge the two dialogue/GM services — reuse the assembler pattern only.

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
