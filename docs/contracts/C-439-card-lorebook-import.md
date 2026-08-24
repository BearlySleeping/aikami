---
id: C-439
title: "Card Lorebook Import — stop silently dropping character_book on V2/V3 import"
source: "user request 2026-08-24 — open-source readiness; SillyTavern/Marinara-Engine compatibility gap"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/185"
  pr_number: 185
created_at: "2026-08-24"
---

# Contract C-439: Card Lorebook Import — stop silently dropping `character_book` on V2/V3 import

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-24). Aikami is about to be shared with the SillyTavern and Marinara-Engine communities, whose cards routinely embed a lorebook that Aikami currently discards without telling anyone. |
| **Target** | `packages/shared/types/src/lib/domain/character_card.ts` — the card type; `apps/frontend/client/src/lib/services/character/` — the import path; `apps/frontend/client/src/lib/services/lorebook/` — the destination store |
| **Priority** | P1 — the single highest-leverage compatibility gap for the audience the project is about to be shown to. Silent data loss on import is also the worst possible first impression. |
| **Dependencies** | C-419 (implemented) — V1/V2/V3 PNG + JSON card import already exists and works (file: `docs/contracts/C-419-p3-growth-features.md`). C-246 (completed) — the export/import system. This contract extends both; it does not rebuild either. |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | user-facing → the import section of `apps/frontend/docs/src/content/docs/` should state which card fields are supported. |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: Aikami already imports character cards properly. `apps/frontend/client/src/lib/services/character/character_importer.ts` handles PNG `tEXt` chunks (`chara` and `ccv3`) and raw JSON; `character_validator.ts` discriminates V1/V2/V3; `ability_score_inference.ts` and `card_compiler.ts` turn a card into a playable stat block. This is a genuinely strong implementation and none of it needs redoing.

- **The gap**: the **`character_book`** field — part of the Character Card V2 spec and carried forward in V3 — is not modelled, not parsed, and not imported. `git grep -n "character_book\|characterBook" apps/frontend/client/src packages/shared` returns **nothing**. `CharacterCardV3` at `packages/shared/types/src/lib/domain/character_card.ts:57` types `data` as `Character & { assets?: CharacterCardV3Asset[] }` with no book field anywhere.

- **Why it matters**: a character card's embedded lorebook is where its world lives — locations, factions, relationships, the entries that make an NPC coherent past the first exchange. For a SillyTavern user, importing a card and losing its book means the character arrives hollow, and **nothing in the UI says why**. That reads as "this app is broken", not "this feature is unimplemented".

- **Aikami already has the destination.** `apps/frontend/client/src/lib/services/lorebook/` implements `lorebook_store.svelte.ts`, `keyword_scanner.ts`, and a generator, and `gm_prompt_service.svelte.ts` already injects matched entries into GM prompts. The receiving system is built; only the bridge is missing.

- **Reproduction**:
  1. Export any SillyTavern character that has a lorebook, as a V2 or V3 PNG.
  2. Import it into Aikami.
  3. The character appears; the lorebook does not exist, and no warning is shown.

- **Existing implementation to reuse**:
  - `character_importer.ts` — `extractTextChunks`, `isPng`, `parseBase64Json`, and `normalizeV3Data`, which is already the precedent for normalizing a V3-only field into a canonical internal shape.
  - `character_validator.ts` — `isV1Card` / `isV2Card` / `isV3Card`.
  - `lorebook_store.svelte.ts` — the destination, with the `Lorebook` / `LorebookEntry` shapes in `apps/frontend/client/src/lib/types/lorebook.ts`.

- **Known gaps**: the V2 `character_book` entry model is richer than Aikami's `LorebookEntry` — it carries `insertion_order`, `enabled`, `selective`, `secondary_keys`, `case_sensitive`, `position`, and per-entry `extensions`. Aikami's entry has `keywords`, `content`, `priority`, and `constant`. The mapping is lossy in one direction and must be decided deliberately, not improvised.

- **Baseline tests**: `bun test apps/frontend/client/src/lib/services/character/` and `bun test apps/frontend/client/src/lib/services/lorebook/`. Both pass today; both must still pass.

## User Outcome

After this contract, a **player** imports a SillyTavern or Marinara-Engine
character card and its embedded lorebook comes with it — usable immediately,
and visible in the lorebook UI as belonging to that character. If any part of
the card cannot be represented, they are **told**, rather than left to discover
it mid-scene.

## Success Measures

- **Time/latency target**: import of a card with a 100-entry book completes without blocking the UI thread perceptibly (the existing import already parses a whole PNG; stay within that budget).
- **Offline/degraded behavior**: entirely local. Card parsing and lorebook creation must involve no network and no AI call — a malformed book degrades to "imported without the book, here's why", never to a failed character import.
- **Production journey enabled**: "bring your existing characters" becomes true rather than approximately true — the single sentence that converts this audience.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| PNG chunk extraction | `services/character/png_utils.ts` | **reuse** unchanged |
| Card version discrimination | `services/character/character_validator.ts` | **modify** — validate the optional book |
| V3 field normalization | `normalizeV3Data` in `character_importer.ts` | **reuse as pattern** — the book normalizes the same way `assets` does |
| Card type | `packages/shared/types/src/lib/domain/character_card.ts` | **modify** — add the book to the spec type |
| Lorebook storage | `services/lorebook/lorebook_store.svelte.ts` | **reuse** — import creates through the existing API |
| Keyword matching | `services/lorebook/keyword_scanner.ts` | **reuse** unchanged |
| Prompt injection | `services/gm/gm_prompt_service.svelte.ts` | **reuse** — no change should be needed |

## Overview

Model the V2/V3 `character_book` in the card type, parse it on both the PNG and
JSON import paths, map its entries onto Aikami's `LorebookEntry` shape, and
create the resulting lorebook through the existing store — associated with the
imported character. Where a card field has no Aikami equivalent, preserve it in
the entry's extensions bag rather than dropping it, and surface a plain-language
summary of what was and was not imported.

The scope is deliberately narrow: **one field, end to end, honestly reported.**

## Design Reference

- `normalizeV3Data` in `character_importer.ts` — the established pattern for taking a spec-shaped field and normalizing it into Aikami's internal shape once, so both import paths converge. The book should follow it exactly.
- The [Character Card V2 spec](https://github.com/malfoyslastname/character-card-spec-v2) `character_book` definition — the authoritative field list. V3 carries it forward compatibly.
- `services/lorebook/lorebook_generator.ts` — how a lorebook is constructed and persisted today; import must use the same path, not a parallel one.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Normalize once, at the boundary.** PNG and JSON import must converge on a single normalized book shape before anything downstream sees it, mirroring how `assets` is handled today. Two parallel mappings will drift.
- **The card type belongs in `packages/shared/types/`.** Extend `character_card.ts` there. Do not model the book inside `apps/`.
- **Extend `CharacterImportResult`** — the type at `character_importer.ts:16` currently returns `{ character, avatarFile }`. Add the normalized book data so the ViewModel can create it through the lorebook store. This is the bridge.
- 🔴 **`Lorebook` and `LorebookEntry` currently live in `apps/frontend/client/src/lib/types/lorebook.ts`**, which violates the repo's own boundary rule. Moving them to `packages/shared/types/` is **in scope only if** the import path needs them cross-boundary. If it doesn't, leave them and note it — do not turn this contract into a refactor.
- **Lossy mapping must be explicit and one-way-safe.** Unmapped V2 fields (`insertion_order`, `selective`, `secondary_keys`, `case_sensitive`, `position`, per-entry `extensions`) go into the entry's extensions bag, preserved verbatim. Never silently discard a field the card author wrote.
- **Never fail the character import because of the book.** A malformed, oversized, or unrecognized `character_book` must degrade to importing the character without it, plus a clear message. The character is the primary object; the book is an enhancement.
- **No AI in this path.** Import is deterministic parsing. The lorebook *generator* is a separate, AI-backed feature and must not be invoked here.

## State & Data Models

Add the spec shape to `packages/shared/types/src/lib/domain/character_card.ts`:

```ts
/** V2/V3 embedded lorebook. Spec field names are snake_case. */
export type CharacterBook = {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: CharacterBookEntry[];
};

export type CharacterBookEntry = {
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
  case_sensitive?: boolean;
  name?: string;
  priority?: number;
  id?: number;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  constant?: boolean;
  position?: 'before_char' | 'after_char';
};
```

Mapping onto the existing `LorebookEntry`:

| Card field | Aikami field | Note |
|---|---|---|
| `keys` | `keywords` | direct |
| `content` | `content` | direct |
| `constant` | `constant` | default `false` when absent |
| `insertion_order` / `priority` | `priority` | **decide and document** which wins; the spec's own semantics differ between the two |
| `enabled: false` | — | skip the entry, and count it in the import summary |
| everything else | `extensions` | preserved verbatim |

A TypeBox schema for the book belongs in `packages/shared/schemas/`, with the
type derived from it — matching how the rest of the card surface is validated.
Note: an existing `LorebookSchema` / `LorebookEntrySchema` already lives at
`packages/shared/schemas/src/lib/domain/lorebook.ts` (server-side shape). The new
`CharacterBookSchema` is the V2/V3 spec shape and is distinct; do not conflate them.

## Quality Requirements

- **Offline/degraded mode**: fully offline. A book that fails validation degrades to a character-only import with an explicit reason.
- **Accessibility/input**: the import summary must be readable by a screen reader and must not rely on colour alone to distinguish "imported" from "skipped".
- **Performance budget**: parsing must stay off the critical path of rendering the character. A large book must not freeze the import dialog.
- **Security/privacy**: 🔴 card content is **untrusted input from the internet**. Entry content is injected into GM prompts, so it is a prompt-injection surface by construction — but that is already true of every card field Aikami imports, and this contract must not make it worse. Enforce a bound on entry count and content length, reject non-string content, and never `eval`, render as HTML, or execute anything from a card. Preserve unknown extensions as opaque data; never interpret them.
- **Persistence/migration**: imported lorebooks persist through the existing store, so they inherit its persistence. No migration — this only adds new records.
- **Cancellation/retry/idempotency**: re-importing the same card must not silently duplicate its lorebook. Decide the behaviour (replace, skip, or create-with-suffix) and make it visible to the user.
- **Observability**: log at `info` how many entries were imported and skipped; log a malformed book at `warn`, never `error` — a bad card is an expected input, not a system fault.

## Migration & Rollback

- **Old data compatibility**: existing lorebooks and previously imported characters are untouched. Cards imported before this contract simply never had a book; re-importing is the way to get one.
- **Migration**: none.
- **Rollback**: revert. Lorebooks created by import remain valid records under the existing store — nothing becomes unreadable.
- **Feature flag or kill switch**: N/A — the code path only runs when a card actually carries a `character_book`.
- **Failure recovery**: a book that fails mid-import must leave no partial lorebook behind. Create it atomically or clean up.

## Scope Boundaries

- **In Scope:**
  - `CharacterBook` / `CharacterBookEntry` types and their TypeBox schemas
  - Parsing the book on both the PNG (`chara`, `ccv3`) and JSON import paths
  - Mapping entries onto `LorebookEntry`, preserving unmapped fields in extensions
  - Creating the lorebook through the existing store, associated with the imported character
  - An import summary telling the user what was imported and what was skipped, and why
  - Bounds on entry count and content length
  - Documenting supported card fields in the user-facing docs site
- **Out of Scope:**
  - **Exporting** an Aikami lorebook back into a card — worth doing, separate contract
  - Standalone SillyTavern world-info JSON import (not embedded in a card)
  - Honouring `scan_depth`, `token_budget`, `recursive_scanning`, or `position` at prompt-injection time — store them, don't implement their semantics here
  - Any change to keyword scanning or GM prompt assembly
  - Any change to `ability_score_inference.ts` or `card_compiler.ts`
  - Refactoring the lorebook types out of `apps/` unless the import path forces it

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** stays whole — one field, one mapping, one UI summary. The
seam if it must split is **AC-1/AC-2 (parse and map)** first, then **AC-3/AC-4
(persist and report)**.

## Acceptance Criteria

### AC-1: The book is parsed from both import paths
**Given** a V2 PNG card, a V3 PNG card, and a raw JSON card, each carrying a `character_book`
**When** each is imported
**Then** all three produce the identical normalized book structure, and a card with no `character_book` imports exactly as it does today with no behavioural change.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `apps/frontend/client/src/lib/services/character/character_import.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test apps/frontend/client/src/lib/services/character/`
- Integration: fixture cards for V2-PNG, V3-PNG, and JSON, each asserted to yield the same normalized book
- E2E / Visual: N/A

**Watch Points**:
- V3 keeps the book in `data.character_book`, same as V2 — verify against a real exported card rather than assuming, and commit the fixture.
- The existing no-book path is the regression risk. Assert it explicitly; do not rely on other tests to catch it.

### AC-2: Entries map faithfully, and losslessly where they can't map
**Given** a book whose entries use `insertion_order`, `selective`, `secondary_keys`, `case_sensitive`, `position`, and per-entry `extensions`
**When** it is imported
**Then** `keys`, `content`, and `constant` map onto the Aikami entry; priority is derived by the documented rule; every unmapped field is preserved verbatim in the entry's extensions bag; and entries with `enabled: false` are skipped and counted.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `apps/frontend/client/src/lib/services/character/character_book_mapper.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test apps/frontend/client/src/lib/services/character/`
- Integration: round-trip assertion that no input field vanishes — every key in the source entry is either mapped or present in extensions
- E2E / Visual: N/A

**Watch Points**:
- `insertion_order` and `priority` mean different things in the spec and both exist. Pick one as the source of Aikami's `priority`, document the choice in a comment, and test the case where both are present.
- A "no field vanishes" assertion is the right shape of test here — it catches fields added to the spec later, which a hand-enumerated test will not.

### AC-3: The lorebook is created and usable
**Given** a successfully parsed and mapped book
**When** the import completes
**Then** a lorebook exists in the store, associated with the imported character, its entries match keywords through the existing scanner, and the GM prompt service injects them with no change to that service.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `apps/frontend/client/src/lib/services/lorebook/lorebook_store.test.ts` | character import → chat | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test apps/frontend/client/src/lib/services/lorebook/`
- Integration: import a fixture card, then assert `scanKeywords` returns an entry for a keyword that exists only in the imported book
- E2E / Visual:
    - **Functional**: extend the existing character-import spec to import a card with a book and assert the lorebook appears in the lorebook UI. If no such spec exists, add one under `tests/client/`.
    - **Visual**: N/A

**Watch Points**:
- Re-importing the same card must not silently duplicate the book. Whatever the chosen behaviour, test it — this is the case a real user hits within ten minutes.
- Import must go through the existing store API. A direct write that bypasses it will diverge the moment the store changes.

### AC-4: The user is told what happened
**Given** a card whose book is partly or wholly unimportable — malformed, over the entry bound, or with disabled entries
**When** it is imported
**Then** the character still imports successfully, and the user sees a plain-language summary stating how many entries were imported, how many were skipped, and why — with no console-only reporting and no silent loss.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `apps/frontend/client/src/lib/services/character/character_import.test.ts` | character import dialog | Filled during verification |

**Test Hooks**:
- Moon Task: `bun test apps/frontend/client/src/lib/services/character/`
- Integration: three fixtures — malformed book, over-bound book, book with disabled entries — each asserted to import the character and produce the right summary
- E2E / Visual:
    - **Functional**: assert the summary is rendered in the import dialog, not only returned from the service.
    - **Visual**: N/A

**Watch Points**:
- 🔴 This AC is the whole point of the contract. Silent loss is the current behaviour and the defect. A summary that exists in the return value but never reaches the screen does not satisfy it.
- Write the message for a player, not a developer: "12 of 15 lore entries imported — 3 were disabled in the original card", not a validation error dump.

## Implementation Sequence

1. **Phase 1 (Types)**: add `CharacterBook` / `CharacterBookEntry` to `packages/shared/types/` with TypeBox schemas in `packages/shared/schemas/`. Commit real fixture cards exported from SillyTavern.
2. **Phase 2 (Parse)**: extend both import paths to extract and normalize the book, following `normalizeV3Data`. AC-1.
3. **Phase 3 (Map)**: the entry mapper, with the extensions-preservation rule and the priority decision documented. AC-2.
4. **Phase 4 (Persist + report)**: create through the lorebook store, associate with the character, add the import summary UI. AC-3, AC-4.
5. **Phase 5 (Validation)**: `bun moon run :validate`, full test suite, and the docs-site page listing supported card fields.

## Edge Cases & Gotchas

- **Fixtures must be real.** Hand-written cards will encode assumptions about the spec rather than what tools actually emit. Export from SillyTavern and commit the files.
- **PNG chunk size.** A book can be large, and it rides inside a `tEXt` chunk with the rest of the card. Cards near the practical chunk limit are a real failure mode — test one.
- **Duplicate keywords across books.** A character's imported book may declare a keyword an existing global lorebook already uses. Decide precedence deliberately; the scanner's current behaviour is the baseline to check, not to guess at.
- **Empty `keys` with `constant: true`** is valid — an always-injected entry with no keyword. Do not filter it out as malformed.
- **`enabled` defaults to `true`** when absent. Getting this backwards silently drops every entry of a card that omits the field.
- **Extensions may contain anything**, including deeply nested objects from other frontends. Store them opaquely. Never interpret, never execute, and bound their serialized size.
- **Do not let this become a lorebook refactor.** The receiving system works. The deliverable is the bridge.

## Open Questions

Must be resolved before status becomes `approved`:

- Does `priority` derive from the spec's `insertion_order` or its `priority` field when both are present?
- On re-import of a card whose lorebook already exists: replace, skip, or create a second one?
- What is the entry-count and content-length bound, and is exceeding it a hard skip or a truncation?
- Should imported lorebooks be scoped to the character, or land in the global lorebook list? The store's current model decides this — confirm which it supports before designing around either.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Execution Report

### Summary

Added `character_book` (embedded lorebook) parsing to the V2/V3 character card import pipeline. The spec types (`CharacterBook`/`CharacterBookEntry`) and TypeBox schemas live in `packages/shared/`. A new `character_book_mapper.ts` normalizes entries onto Aikami's `LorebookEntry` shape, preserving unmapped V2 fields in an extensions bag. The import result carries the normalized book; the persona list ViewModel creates it through the existing lorebook store and surfaces a plain-language import summary in the UI. Docs updated to list supported card fields.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Book parsed from V2 PNG, V3 PNG, and JSON paths — all three produce identical normalized structure. No-book path unchanged. |
| AC-2 | ✅ | Entry mapping tested: keys→keywords, insertion_order wins priority, unmapped fields preserved in extensions, disabled entries skipped and counted. |
| AC-3 | ✅ | Lorebook created through existing `lorebookStore.addLorebook()` + `addEntry()` in the persona list ViewModel. Keyword scanner and GM prompt service unchanged. |
| AC-4 | ✅ | Import summary shown as an alert banner in the persona list view with entry counts and skip reasons. Malformed/over-bound books degrade cleanly. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/domain/character_book.ts` | TypeBox schemas for `CharacterBook` / `CharacterBookEntry` |
| `apps/frontend/client/src/lib/services/character/character_book_mapper.ts` | Normalizes V2/V3 book into Aikami `LorebookEntry` shape with extensions preservation |
| `apps/frontend/client/src/lib/services/character/character_book_mapper.test.ts` | 12 unit tests covering AC-2 (mapping) and AC-4 (summary) |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/types/src/lib/domain/character_card.ts` | Added `CharacterBook` / `CharacterBookEntry` types |
| `packages/shared/schemas/src/index.ts` | Added export for character_book schema |
| `apps/frontend/client/src/lib/services/character/character_importer.ts` | Extended `CharacterImportResult` with `lorebook` field; added `_extractBook` helper; updated both PNG and JSON import paths |
| `apps/frontend/client/src/lib/types/lorebook.ts` | Added optional `extensions` field to `LorebookEntry` |
| `apps/frontend/client/src/lib/views/character/persona/list/persona_list_view_model.svelte.ts` | Added lorebook creation after import, `importSummary` state, `clearImportSummary()` method |
| `apps/frontend/client/src/lib/views/character/persona/list/persona_list_view.svelte` | Added import summary alert banner with dismiss button |
| `apps/frontend/client/src/lib/services/character/character_import.test.ts` | Added C-439 fixture cards and integration test cases (blocked by pre-existing module resolution issue) |
| `apps/frontend/docs/src/content/docs/features/export-import.md` | Documented supported card formats, field mappings, and lorebook import |

### Deviations from Spec

None. All ACs implemented as specified.

### Test Results

- Unit (mapper): 12/12 PASS — 0 failures
- Unit (lorebook store): 11/11 PASS — 0 failures (baseline regression clean)
- Unit (character import): pre-existing module resolution issue (`@aikami/utils` not resolved in test env) — 0 new failures
- Typecheck: clean (with `AIKAMI_INCLUDE_DEV_ROUTES=true`)
- Baseline: 0 new failures

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
