---
id: C-419
title: "P3 Growth Batch — Character Card Import and Merchant UI Refinement"
source: "docs/contracts/MVP_BACKLOG.md (seeds C-415, C-416); re-verified against main 2026-08-17"
status: draft
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
| **Status** | draft |
| **Promotion** | `—` |
| **Docs Impact** | internal |
| **Contract version** | 2.0.0 |

This contract absorbs two originally-separate backlog seeds (C-415, C-416)
into one file per explicit user direction. Each feature below is
independently mergeable — see [Contract Size & Split Rule](#contract-size--split-rule).

**Re-verification note:** a fact-check pass on 2026-08-17 found Feature A's
seed reference implementation no longer exists in this repository — the
`examples/Marinara-Engine/` tree is gone, and neither `examples/` nor any
`Marinara-Engine` directory exists anywhere in the tree. Feature A is
reframed to reference the external SillyTavern card format directly rather
than a now-nonexistent local reference implementation. Feature B holds as
written, with corrected line numbers.

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
  `character-token-count.ts`) as local code to read. **None of these exist in
  this repository** — a full-tree glob for `examples/` and for
  `*Marinara*` returns nothing. The only surviving trace is a stray comment,
  `// ── Narrative Traits (Marinara-inspired) ──`, at
  `packages/shared/schemas/src/lib/domain/character.ts:211`, suggesting
  Marinara Engine was a design inspiration at some point, not a vendored
  package still present to read. **Implementation must work from the public
  SillyTavern character-card V2/V3 spec directly** — there is no local
  reference to lean on.
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
- **Reproduction**: N/A — new feature, no existing broken behavior to
  reproduce.
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
| Vendor haggle panel | `vendor_view.svelte:246-248` | **modify** — collapse when empty |
| Vendor item icon | `vendor_view.svelte:180-205, 386` | **replace** — content-pack art, 📦 as last-resort fallback only |

## Overview

Two independent P3 items, batched into one contract file. Character card
import is scoped against the public SillyTavern V2/V3 spec rather than a
local reference implementation, since the seed's cited example package no
longer exists in this repo. Merchant UI refinement proceeds as originally
scoped, with corrected line numbers.

## Design Reference

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

- **Feature A**: implement against the public SillyTavern character-card
  V2/V3 JSON spec (embedded in PNG `tEXt`/`zTXt` chunks, base64-encoded).
  No local reference implementation exists to port from — this is a
  from-spec implementation, which changes the size/risk profile from what
  the original seed implied ("read this file and adapt it").
- **Feature B**: collapse the haggle panel to a slim "Start a conversation"
  affordance until engaged, following whatever collapsed/expanded pattern
  already exists elsewhere in the client (check `dialogue_overlay.svelte`'s
  suggestion-chip collapse behavior, touched by C-417, for a precedent
  before inventing a new one).

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
/** Parsed SillyTavern V2/V3 card, before schema compilation. */
type CharacterCardV2 = {
  readonly spec: 'chara_card_v2';
  readonly spec_version: '2.0';
  readonly data: {
    readonly name: string;
    readonly description: string;
    readonly personality: string;
    readonly scenario: string;
    readonly first_mes: string;
    readonly mes_example: string;
    // ...remaining V2 fields per the public spec
  };
};

/** Result of compiling a parsed card into Aikami's schema, before ability-score inference. */
type CardCompilationResult = {
  readonly sheet: unknown; // NpcSheetSchema | PersonaSheetSchema, minus abilityScores
  readonly abilityScoresInferred: boolean;
};
```

No new persisted schema — imported cards land in the existing NPC/persona
tables via `NpcSheetSchema`/`PersonaSheetSchema`.

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
substantially larger and riskier than Feature B (it is a from-spec
implementation with no local reference, unlike what the original seed
assumed); if its scope grows enough to threaten review quality on its own,
split it into its own contract and record that as an amendment rather than
shrinking Feature B to compensate.

## Acceptance Criteria

### AC-1: A SillyTavern V2 card imports as a persona
**Given** a valid SillyTavern V2-format character-card PNG
**When** the player imports it as a persona
**Then** name, description, personality, and scenario map into
`PersonaSheetSchema` fields, and ability scores are populated (inferred if
absent from the card)

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
| AC-3 | Visual | client visual suite | `/game` vendor view | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-visual`
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
| AC-4 | Visual | client visual suite | `/game` vendor view | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-visual`
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

1. **Phase 1 (Data/Logic)** — Feature A: implement the V2/V3 parser against
   the public spec, with schema validation, fully unit-tested and
   AI-independent. Feature B: identify the content-pack item-art resolution
   pattern to reuse.
2. **Phase 2 (Integration)** — Feature A: wire the compiler into
   persona/NPC creation UI, add the ability-score inference step. Feature B:
   collapse the haggle panel, wire item art into the vendor view.
3. **Phase 3 (Validation)** — Run the four Evidence Matrix checks above,
   `moon run client:test-unit`, `moon run client:test-visual`,
   `bun run typecheck`.

## Edge Cases & Gotchas

- **Feature A**: card PNGs can carry the character JSON in either `tEXt`
  (V2, base64 in a `chara` keyword) or newer embedding conventions per V3 —
  confirm both are handled, do not assume V2's embedding format for V3.
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
- **OQ-4** — Feature B: does the content-pack format already declare
  per-item art references, or does this contract also need to add that
  declaration to the manifest schema? Check `ContentPackManifest` before
  scoping the art-resolution work.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-08-17 | Initial draft merging seeds C-415, C-416. Feature A's reference implementation reframed from a local `examples/Marinara-Engine/` package (confirmed not present in this repo) to the public SillyTavern V2/V3 spec directly, which changes the size/risk profile of the feature. Feature B carried forward with corrected line numbers, no scope change. | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`** for Feature A (production import flow + tests);
**`release_verified`** for Feature B given its visual nature.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
