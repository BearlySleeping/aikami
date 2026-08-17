---
id: C-419
title: "P3 Growth Batch — Character Card Import and Merchant UI Refinement"
source: "docs/contracts/MVP_BACKLOG.md (seeds C-415, C-416); re-verified against main 2026-08-17"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-17"
---

# Contract C-419: P3 Growth Batch — Character Card Import and Merchant UI Refinement

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/contracts/MVP_BACKLOG.md` seeds C-415, C-416 (`mvp-assessment-2026-08-16.md` §5.2), re-verified against `main` 2026-08-17 |
| **Target** | client persona/NPC import (schema TBD); `apps/frontend/client/src/lib/views/vendor/vendor_view.svelte` |
| **Priority** | P3 — growth, after the P0/P1/P2 blocks land |
| **Dependencies** | — |
| **Status** | approved |
| **Promotion** | `—` |
| **Docs Impact** | internal |
| **Contract version** | 2.0.0 |

This contract absorbs two originally-separate backlog seeds (C-415, C-416)
into one file per explicit user direction. Each feature below is
independently mergeable — see [Contract Size & Split Rule](#contract-size--split-rule).

**Re-verification note:** a fact-check pass on 2026-08-17 found the seed's
cited `examples/Marinara-Engine/` files no longer exist (no `examples/` or
`Marinara*` anywhere in the tree). Critic re-verification (2026-08-17)
found the seed's other assumption — "no local reference to lean on" — is
also false: a complete SillyTavern-format import pipeline (types, PNG
`tEXt` extraction, V1/V2/RisuAI/Aikami parsing, NPC import UI) exists from
C-246 and is in production. Feature A is reframed as an *extension* of that
pipeline (V3 `ccv3` parsing, ability-score inference, persona-targeted
UI), not a from-spec greenfield build. Feature B holds as written, with
corrected line numbers and corrected test-task references.

---

## Problem & Baseline Evidence

### Feature A — Character card (V2/V3) import (absorbs seed C-415)

- **Rationale, unchanged**: supporting the SillyTavern character-card PNG
  format plugs Aikami into an existing library of tens of thousands of
  community characters on day one — the cheapest way to make worlds feel
  populated without authoring content.
- **Reference implementation, corrected from the seed**: the seed pointed at
  `examples/Marinara-Engine/packages/client/src/lib/character-import.ts` and
  three sibling files (`card-asset-links.ts`, `card-version-history.ts`,
  `character-token-count.ts`) as local code to read. **Those specific files
  do not exist** — a full-tree glob for `examples/` and for `*Marinara*`
  returns nothing; the only surviving trace is a stray comment,
  `// ── Narrative Traits (Marinara-inspired) ──`, at
  `packages/shared/schemas/src/lib/domain/character.ts:211`. **However, a
  complete SillyTavern-format import pipeline already exists in this repo
  (built by C-246, completed + `integrated`)** — the seed's "no local
  reference" framing is false and must not be treated as greenfield work:
  - `packages/shared/types/src/lib/domain/character_card.ts` defines
    `Character` (card-format persona), `CharacterCardV1`, and
    `CharacterCardV2` (`spec: 'chara_card_v2'`, `spec_version: '2.0'`) — the
    exact shapes this contract's State & Data Models section previously
    proposed as *new* types. **Reuse these; do not redeclare them.**
  - `apps/frontend/client/src/lib/services/character/character_importer.ts`
    implements `importFromPng`/`importFromJson` with PNG `tEXt` chunk
    extraction (`chara` for V2, `cbar` for RisuAI, `aikami_character` for
    Aikami cards), V1→V2 conversion, and V2 validation.
  - `character_validator.ts` (`isV1Card`/`isV2Card`), `png_utils.ts`
    (`extractTextChunks`, `isPng`), and `png_writer.ts` (export side) round
    out the pipeline.
  - An **NPC import UI already exists**:
    `apps/frontend/client/src/lib/views/character/npc/list/npc_list_view.svelte`
    + `npc_list_view_model.svelte.ts` (`handleFileImport`/`handleUrlImport`)
    → `npcService.importFromFile`/`importFromUrl`
    (`npc_service.svelte.ts:103,165-228`) maps cards into `NpcCreateData`
    (`name`, `notes`←description, `personality`, `scenario`,
    `firstMessage`←`first_mes`, `systemPrompt`) and uploads the avatar.
  - A player-character import path exists via
    `character.svelte.ts:116-126` (`importFileWithAvatar`).
  **The real delta for this contract is therefore: (1) V3 (`ccv3` chunk)
  parsing — currently only *detected* with a debug log, never parsed
  (`character_importer.ts:147`); (2) ability-score inference — no import
  path populates `abilityScores` today; (3) a *persona*-targeted import UI
  (only NPC and player-character flows exist); (4) dedupe/re-import policy
  (OQ-3). The public SillyTavern V2/V3 spec is still the source of truth
  for field semantics, but it is an *extension* task on top of the C-246
  pipeline, not a from-spec rewrite.
- **Design constraint, confirmed accurate**: an imported card must compile
  into the existing NPC/persona schema, including six ability scores. Cards
  do not carry stats natively.
  - `packages/shared/schemas/src/lib/domain/character.ts:8-31`
    (`AbilityScoresSchema`, `ABILITY_KEYS`, `ABILITY_LABELS`) defines the six
    scores once, reused by `NpcSheetSchema`
    (`packages/shared/schemas/src/lib/domain/npc.ts:9-35`, via
    `BaseCharacterSheetSchema`) and `PersonaSheetSchema`
    (`packages/shared/schemas/src/lib/domain/persona.ts:8`).
  - `abilityScores` is `Type.Optional(...)` on `BaseCharacterSheetSchema`
    (`character.ts:273`) — nothing currently forces a card-derived
    persona/NPC to carry stats, confirming the defaulting/inference step is
    the open design problem, not a schema blocker.
  - **A defaulting precedent already exists**:
    `apps/frontend/client/src/lib/data/ai_prompts/character_extraction_schema.ts`
    makes `abilityScores` a *required* field in its LLM-extraction schema and
    instructs the model (lines 95-103) to "creatively infer" the six scores
    from a 2024 standard array when the source material doesn't discuss them
    explicitly. This is a directly reusable pattern for card import's
    inference step.
- **Reproduction**: N/A — no broken behavior to reproduce; the V2 import
  path already exists (C-246) and the new work (V3 parsing, ability-score
  inference, persona-targeted wiring) is additive.
- **Existing implementation to reuse**: `AbilityScoresSchema`,
  `NpcSheetSchema`/`PersonaSheetSchema`, and the inference-prompt pattern in
  `character_extraction_schema.ts`.

### Feature B — Merchant UI refinement (absorbs seed C-416)

- **Current behavior, confirmed accurate, line numbers updated**:
  `apps/frontend/client/src/lib/views/vendor/vendor_view.svelte` (593 lines,
  last touched 2026-07-30):
  - Empty-state haggle text `"Start a conversation to haggle with the
    vendor"` at **line 248**, inside a `flex-1` container of the 3/5-width
    left chat pane (itself `h-[80vh]`) — occupies roughly half the screen
    while empty, matching the seed's characterization.
  - Generic 📦 emoji used both as the vendor-inventory-empty icon
    (**line 386**) and as the default per-item fallback in `_itemIcon()`
    (**line 205**, function starts **line 180**) — items get a specific
    emoji only via substring match on `itemId`
    (⚔️🛡️🧪🪙💍📜🏹); there is no item-art/image rendering path at all.
- **Elements to preserve, confirmed still present and working**:
  - Gold display: `🪙 {viewModel.playerGold}` badge, **lines 339-342**.
  - "Need X more" affordance: `💰 Need {finalPrice - viewModel.playerGold}
    more`, **line 463**.
  - Stat deltas: `⚔️ +{definition.attackBonus}` /
    `🛡️ +{definition.defenseBonus}`, **lines 437-446**.
  - Keyboard hints: input-area hint (`Enter`/`Shift+Enter`, **lines
    323-329**) and footer hint (`Esc close` / `Enter send`, **lines
    568-577**), with actual handling for both the modal (`handleKeyDown`,
    referenced **line 216**) and the sell-confirm dialog (**line 557**).
- **Minor unrelated observation**: lines 433-436 have a duplicated
  `<!-- Stats (if equippable) -->` comment four times in a row — cosmetic,
  not part of this contract's scope, safe to clean up incidentally if
  touching that block.
- **Reproduction**: open the vendor view with no chat started (haggle panel
  dominates the screen empty); browse inventory (every item shows 📦 unless
  its id happens to substring-match a mapped emoji).

---

## User Outcome

After this contract:
- A **player** can import a SillyTavern-format character card (V2 or V3) as
  either a persona or an NPC, with ability scores inferred when the card
  doesn't declare them.
- A **player** browsing a vendor sees item icons drawn from content-pack art
  instead of a generic box emoji, and the haggle panel doesn't dominate the
  screen before a conversation starts.

## Success Measures

- **Time/latency target**: N/A for either feature.
- **Offline/degraded behavior**: Feature A's ability-score inference should
  work without a network call where possible (e.g., a deterministic default
  array) with LLM-based inference as an enhancement, not a hard requirement —
  confirm during design (OQ-2).
- **Production journey enabled**: Feature A opens an entire external content
  ecosystem to Aikami on day one; Feature B removes the last visibly rough
  edge from what the assessment calls "already the strongest screen in the
  build."

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Six ability scores | `AbilityScoresSchema` (`character.ts:8-31`) | **reuse** |
| NPC/Persona sheet schemas | `npc.ts:9-35`, `persona.ts:8` | **reuse** — import target shape |
| Stat-inference prompt pattern | `character_extraction_schema.ts:95-103` | **reuse** as the inference-step template |
| Card-format types (V1/V2) | `packages/shared/types/src/lib/domain/character_card.ts` (`Character`, `CharacterCardV1`, `CharacterCardV2`) | **reuse** — do NOT redeclare; the old State & Data Models `CharacterCardV2` proposal collides with this export |
| PNG `tEXt` extraction + PNG validation | `services/character/png_utils.ts` (`extractTextChunks`, `isPng`) | **reuse** |
| V1/V2/RisuAI/Aikami card parser | `services/character/character_importer.ts` (`importFromPng`, `importFromJson`) | **extend** — add V3 (`ccv3`) parsing; keep existing format handling |
| Card validation | `services/character/character_validator.ts` (`isV1Card`, `isV2Card`) | **extend** — add `isV3Card` |
| NPC import UI + service mapping | `views/character/npc/list/npc_list_view*.svelte.ts`, `npc_service.svelte.ts:165-228` | **reuse** — NPC side largely done; add ability-score mapping |
| Player-character import UI | `character.svelte.ts:116-126` | **reuse** — persona-adjacent path; verify whether it satisfies AC-1's persona flow or a persona-targeted UI is needed |
| Duplicate `parsePngCard` helpers | `utils/character_importer.ts` and `views/utils/character_importer.ts` (near-identical) | **consolidate** — do not add a third copy; prefer the `services/character` pipeline |
| Vendor haggle panel | `vendor_view.svelte:246-248` | **modify** — collapse when empty |
| Vendor item icon | `vendor_view.svelte:180-205, 386` | **replace** — content-pack art, 📦 as last-resort fallback only |
| Per-item art reference | `lpcAssetId` on content-pack item schema (`packages/shared/schemas/src/lib/game/content_pack.ts:155-156`) + runtime `ITEM_CATALOG` (`inventory_service.svelte.ts:42-296`) | **reuse** — already declared; shared `ItemDefinition` type (`schemas/src/lib/domain/item.ts:95-100`) does NOT expose it, so widen the type or resolve art via the content-pack catalog |
| Vendor visual suite | `apps/e2e/src/visual/suites/vendor.visual.ts` (C-331 AC-3, targets `/dev/vendor`) | **extend** — add collapsed-panel + item-art cases |

## Overview

Two independent P3 items, batched into one contract file. Character card
import extends the existing C-246 import pipeline (V3 parsing, ability-
score inference, persona-targeted wiring) rather than starting from the
public SillyTavern V2/V3 spec cold, since the seed's cited example package
is gone but a production V1/V2 importer already exists. Merchant UI
refinement proceeds as originally scoped, with corrected line numbers.

## Design Reference

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

- **Feature A**: **extend the existing C-246 pipeline**, treating the public
  SillyTavern character-card V2/V3 JSON spec (embedded in PNG `tEXt`/`zTXt`
  chunks, base64-encoded) as the source of truth for field semantics. The
  V2 path is already implemented and in production (`importFromPng`); the
  new work is V3 (`ccv3` chunk) parsing, ability-score inference, and
  persona-targeted wiring. Do not redeclare `CharacterCardV2` — import it
  from `@aikami/types`.
- **Feature B**: collapse the haggle panel to a slim "Start a conversation"
  affordance until engaged, following a collapsed/expanded precedent that
  actually exists. Note: `dialogue_overlay.svelte` (C-417) has *no*
  collapse behavior — its suggestion chips scroll horizontally but never
  collapse. Verified collapse precedents to copy instead:
  `combat_sidebar.svelte`, `initiative_tracker.svelte`,
  `style_profile_editor.svelte`, `connection_editor_panel.svelte`.

## Architecture Directives

- **Feature A**: card parsing and the stats-inference step should be
  separable — parsing is deterministic and testable without any AI call;
  inference is the only part that may call an LLM. Do not couple them into
  one non-mockable function.
- **Feature A**: imported cards compile into `NpcSheetSchema` or
  `PersonaSheetSchema` — never a new parallel type. A card is a
  persona/NPC, never a campaign.
- **Feature B**: item-art resolution should follow the existing content-pack
  asset-lookup pattern (however the LPC/item catalog already resolves
  asset ids) rather than inventing a second art-lookup path.

## State & Data Models

```ts
// Reuse — already exported from @aikami/types (packages/shared/types/src/lib/domain/character_card.ts).
// Do NOT redeclare. This is the parsed V2 card shape.
type CharacterCardV2 = {
  spec: 'chara_card_v2';
  spec_version: '2.0';
  data: Character; // { name, description, personality, scenario, first_mes,
  //   mes_example, creator_notes, system_prompt, post_history_instructions,
  //   alternate_greetings, tags, creator, character_version, extensions }
};

/** V3 card — add to character_card.ts; `data` may carry `assets` (V3-only). */
type CharacterCardV3 = {
  spec: 'chara_card_v3';
  spec_version: '3.0';
  data: Character & { assets?: Record<string, unknown> };
};

/** Result of compiling a parsed card into Aikami's schema, before ability-score inference. */
type CardCompilationResult = {
  readonly sheet: unknown; // NpcSheetSchema | PersonaSheetSchema, minus abilityScores
  readonly abilityScoresInferred: boolean;
};
```

No new persisted schema — imported cards land in the existing NPC/persona
tables via `NpcSheetSchema`/`PersonaSheetSchema`. The compiler output must
carry the card's six inferred/declared scores into `abilityScores`, which is
`Type.Optional` on `BaseCharacterSheetSchema` (`character.ts:273`) — the
schema already accepts a fully-populated sheet.

## Quality Requirements

- **Offline/degraded mode**: card parsing must work fully offline; ability
  score inference should degrade to a fixed default array (not block import)
  when no AI provider is available.
- **Accessibility/input**: Feature B's collapsed haggle panel and item icons
  must remain keyboard-navigable.
- **Performance budget**: N/A for either feature.
- **Security/privacy**: Feature A parses arbitrary user-supplied PNG files —
  validate the embedded JSON against a schema before use; do not `eval` or
  otherwise execute anything from card content.
- **Persistence/migration**: N/A — imported cards use existing schemas.
- **Cancellation/retry/idempotency**: re-importing the same card should not
  silently duplicate a persona/NPC — needs a dedupe or overwrite decision
  (OQ-3).
- **Observability**: log card-import failures with the specific validation
  error, not a generic "import failed."

## Migration & Rollback

N/A — no persistent schema changes for either feature. Both are additive
(Feature A) or purely presentational (Feature B) and revert cleanly via
their own commits.

## Scope Boundaries

- **In Scope:**
  - Feature A: parse SillyTavern V2/V3 PNG cards; compile into
    `NpcSheetSchema`/`PersonaSheetSchema`; infer ability scores when absent.
  - Feature B: collapse the haggle panel until a conversation starts; render
    item icons from content-pack art, falling back to 📦 only when no art
    exists.

- **Out of Scope:**
  - Feature A: character-card *export* (writing Aikami personas back out as
    cards) — import only.
  - Feature A: any card format other than SillyTavern V2/V3 (e.g., Character
    AI, Chub formats) — future work if this succeeds.
  - Feature B: any change to haggle negotiation logic itself — presentation
    only.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** bundles two unrelated P3 items — no shared data model
or invariant — per explicit user direction. Each feature has its own
Problem, Scope, and AC block and is independently mergeable. Feature A is
larger than Feature B (V3 parsing + inference + persona wiring on top of
the existing C-246 pipeline); if its scope grows enough to threaten review
quality on its own, split it into its own contract and record that as an
amendment rather than shrinking Feature B to compensate.

## Acceptance Criteria

### AC-1: A SillyTavern V2 card imports as a persona
**Given** a valid SillyTavern V2-format character-card PNG
**When** the player imports it as a persona
**Then** the card maps into `PersonaSheetSchema` fields (name → `name`;
description → `background`; personality → `personalityTraits`; scenario →
`notes` — `PersonaSheetSchema` has no `description`/`personality`/`scenario`
keys, so follow the established `convertAikamiCardToCharacter` precedent at
`character_importer.ts:74-95`), and ability scores are populated (inferred
if absent from the card)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | card-import parser/compiler unit tests | persona import UI | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: import a known-good sample card (e.g., a publicly available
  V2 test fixture), assert the compiled `PersonaSheetSchema` fields.
- E2E / Visual: **Functional**: an import-flow spec covering file selection
  through persona creation. **Visual**: N/A.

**Watch Points**:
- Validate the embedded JSON against the V2 spec schema before compiling —
  malformed or adversarial card content must fail cleanly, not crash the
  import UI.

### AC-2: A V3 card and a stats-free card both import successfully
**Given** a SillyTavern V3-format card, and separately a V2 card with no
stat-relevant fields
**When** each is imported
**Then** the V3 card imports without loss of its additional fields, and the
stats-free card receives inferred ability scores rather than failing
validation

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | card-import parser/compiler unit tests | persona/NPC import UI | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: fixture-based tests for both V2 and V3 spec variants.
- E2E / Visual: N/A.

**Watch Points**:
- V2 and V3 differ in field set — do not assume V2 parsing logic covers V3
  without checking the spec diff.

### AC-3: Haggle panel stays out of the way until engaged
**Given** the vendor view with no conversation started
**When** the player opens the vendor
**Then** the haggle panel occupies a minority of the screen rather than
~50%, with an obvious affordance to start haggling

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Visual | `apps/e2e/src/visual/suites/vendor.visual.ts` (extend existing C-331 suite) | `/game` vendor overlay (`game_ui_view.svelte:169-170`); suite routes `/dev/vendor` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:run-visual-tests` (visual runner at `apps/e2e/src/visual/runner.ts`; `client:test-visual` does not exist)
- Integration: open vendor view, screenshot before/after conversation start.
- E2E / Visual: **Visual**: score 90+: collapsed panel takes up a minority of
  the layout; expands cleanly once a conversation starts.

**Watch Points**:
- Keep gold display, "Need X more," stat deltas, and keyboard hints
  unchanged — these already work well per the fact-check.

### AC-4: Vendor items render content-pack art, not a generic box
**Given** a vendor whose inventory items have content-pack art defined
**When** the vendor view renders
**Then** each item shows its specific icon/art, with 📦 used only as a
last-resort fallback for items with no art

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Visual | `apps/e2e/src/visual/suites/vendor.visual.ts` (extend existing C-331 suite) | `/game` vendor overlay (`game_ui_view.svelte:169-170`); suite routes `/dev/vendor` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:run-visual-tests` (visual runner at `apps/e2e/src/visual/runner.ts`; `client:test-visual` does not exist)
- Integration: render a vendor with a mixed inventory (some items with art,
  some without), assert icon resolution per item.
- E2E / Visual: **Visual**: score 90+: distinct item art visible, no
  uniform 📦 across dissimilar items.

**Watch Points**:
- `_itemIcon()`'s current substring-match emoji mapping
  (⚔️🛡️🧪🪙💍📜🏹) should stay as a secondary fallback tier between
  real art and 📦, not be deleted outright — it's better than nothing for
  items that lack dedicated art.

## Implementation Sequence

1. **Phase 1 (Data/Logic)** — Feature A: add V3 (`ccv3`) parsing to the
   existing `character_importer.ts` pipeline plus `isV3Card` in
   `character_validator.ts`, with schema validation, fully unit-tested and
   AI-independent. Feature B: expose `lpcAssetId` on the vendor's
   `ItemDefinition` path (widen type or resolve via `content_pack_catalog`).
2. **Phase 2 (Integration)** — Feature A: add the ability-score inference
   step (deterministic default + optional LLM), wire the compiler into a
   persona-targeted import flow (NPC flow already exists via
   `npc_service.importFromFile`), map scores into
   `NpcSheetSchema`/`PersonaSheetSchema`. Feature B: collapse the haggle
   panel, wire item art into the vendor view.
3. **Phase 3 (Validation)** — Run the four Evidence Matrix checks above,
   `moon run client:test-unit`, `moon run e2e:run-visual-tests`,
   `bun run typecheck`.

## Edge Cases & Gotchas

- **Feature A**: card PNGs carry the character JSON in a `tEXt` chunk
  (base64 in a `chara` keyword for V2, `cbar` for RisuAI, and `ccv3` for
  V3 — the existing importer already detects `ccv3` at
  `character_importer.ts:147` but never parses it). Implement V3 against
  the `ccv3` chunk; do not assume V2's embedding format for V3.
- **Feature A**: cards can be malicious/malformed (arbitrary PNG content
  wrapped around adversarial JSON) — treat all card content as untrusted
  input; validate before compiling.
- **Feature A**: re-importing an already-imported card — decide dedupe vs.
  overwrite vs. always-create-new before shipping (OQ-3).
- **Feature B**: `_itemIcon()`'s substring match on `itemId` is fragile —
  don't let the new art-resolution path depend on the same fragile matching;
  key off a declared content-pack asset reference instead.

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1** — Feature A: which SillyTavern spec version(s) exactly — V2 only,
  or V2 and V3 both from day one? The seed named "V2/V3" but scoping both at
  once roughly doubles Feature A's size.
- **OQ-2** — Feature A: should ability-score inference require an AI call
  (reusing `character_extraction_schema.ts`'s pattern), or should there be a
  network-free deterministic default (e.g., flat array) as a fallback when no
  provider is available? Affects the Offline/degraded quality requirement.
- **OQ-3** — Feature A: re-import behavior — dedupe by card hash, overwrite
  by name, or always create a new persona/NPC?
- **OQ-4** — Feature B: per-item art references — **resolved by codebase
  evidence: YES, already declared.** `lpcAssetId` exists on the content-pack
  item schema (`packages/shared/schemas/src/lib/game/content_pack.ts:155-156`)
  and is populated per item in the runtime `ITEM_CATALOG`
  (`inventory_service.svelte.ts:42-296`). The gap is that the shared
  `ItemDefinition` type (`schemas/src/lib/domain/item.ts:95-100`) does not
  expose `lpcAssetId`, so the vendor's `getItemDef()` drops it at the type
  level. **No manifest schema change is needed** — either widen
  `ItemDefinitionSchema` with `lpcAssetId` or resolve art through the
  content-pack catalog (`content_pack_catalog.ts`), keyed off
  `definition.lpcAssetId`. (Was previously an open question; answer is
  determinable from the codebase, so the contract no longer needs it open.)

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-08-17 | Initial draft merging seeds C-415, C-416. Feature A's reference implementation reframed from a local `examples/Marinara-Engine/` package (confirmed not present in this repo) to the public SillyTavern V2/V3 spec directly, which changes the size/risk profile of the feature. Feature B carried forward with corrected line numbers, no scope change. | — |
| 2.0.0 | 2026-08-17 | Critic re-verification: corrected Feature A's false "no local reference" premise — the C-246 SillyTavern import pipeline (types, PNG `tEXt` extraction, V1/V2/RisuAI/Aikami parsing, NPC import UI) already exists and is in production; Feature A is reframed as an extension (V3 `ccv3` parsing, ability-score inference, persona-targeted UI). Reuse Map expanded; State & Data Models now reuses `@aikami/types` `CharacterCardV2` instead of redeclaring; AC-3/AC-4 test hooks corrected from nonexistent `client:test-visual` to `e2e:run-visual-tests` with the existing `vendor.visual.ts` suite; Design Reference collapse precedent corrected (`dialogue_overlay.svelte` has no collapse behavior); OQ-4 resolved from codebase evidence. Scope unchanged. | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`** for Feature A (production import flow + tests);
**`release_verified`** for Feature B given its visual nature.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
