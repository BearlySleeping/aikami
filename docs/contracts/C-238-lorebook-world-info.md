## Metadata
<!-- audit: legacy — no execution report -->

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/CONVERSATION.md` (lorebooks in conversation), `docs/ROLEPLAY.md` (lorebooks in roleplay, Active Context panel), `docs/GAME_MODE.md` (lorebooks for world-gen), `docs/FRONTEND.md` (LorebookEditor, lorebook schema); TODO.md C-ME-009 |
| **Target** | `apps/frontend/client/src/lib/services/lorebook/` + `apps/frontend/client/src/lib/views/lorebook/` — Lorebook data model, keyword scanner, editor, World Info panel |
| **Priority** | P2 — Lorebooks are the primary world-building tool; they let GMs author persistent world knowledge without engineering prompts |
| **Dependencies** | C-237 (Macro System — COMPLETED for macro support in entry content), `ConfigService` (localStorage persistence), `gmPromptService` (C-235 — COMPLETED for prompt injection), `textGenerationService.extractStructure()` (AI lorebook generator) |
| **Status** | completed |
| **Contract version** | 1.0.0 |

## Overview

Aikami has no lorebook system. All world knowledge is either hardcoded in system prompts or generated once during world-gen (C-233). Marinara-Engine provides a rich lorebook system: named collections of entries, each with keyword triggers and injection rules. Two entry types — constant (always injected into prompts) and keyword-triggered (injected when keywords appear in recent messages). An Active Context panel shows which entries are currently firing. An AI lorebook maker generates structured entries from free-text world notes. This contract builds the full lorebook stack: data model, keyword scanner, editor UI, Active Context panel, and AI generator — all feeding into the GM prompt via C-235.

## Design Reference

**Existing code to extend:**
- `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts` — C-235's `assemblePrompt()`; lorebook entries are injected as a `[WORLD INFO]` section
- `apps/frontend/client/src/lib/services/config/config_service.svelte.ts` — existing localStorage persistence; lorebooks stored here
- `packages/shared/parser/src/lib/macro_resolver.ts` — C-237's `resolveMacros()`; lorebook entry content supports macros
- `apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts` — `extractStructure()` for AI lorebook generator

**Marinara-Engine inspiration:**
- Lorebook schema: `examples/Marinara-Engine/packages/shared/src/schemas/lorebook.schema.ts`
- Lorebook types: `examples/Marinara-Engine/packages/shared/src/types/lorebook.ts` (Lorebook, LorebookEntry, ActivationCondition)
- Conversations: `examples/Marinara-Engine/docs/CONVERSATION.md` (constant + keyword-triggered, per-chat attachment)
- Roleplay: `examples/Marinara-Engine/docs/ROLEPLAY.md` (Active Context panel)
- Game Mode: `examples/Marinara-Engine/docs/GAME_MODE.md` (constant entries for world-gen seeding)

**Testing conventions:** See `.pi/skills/testing/SKILL.md`.

## Architecture Directives

- **Lorebook data model**: Stored in `ConfigService` (localStorage). Each lorebook has `id`, `name`, `description`, `entries[]`, `isBuiltIn`. Each entry has `keywords[]`, `content` (macro-enabled), `constant` flag, `position` (before/after system prompt), `priority` (determines injection order).
- **Keyword scanner**: Pure function `scanKeywords(recentMessages: string, entries: LorebookEntry[]): LorebookEntry[]`. Returns matched entries sorted by priority. Constant entries always included. Matched entries deduplicated. Case-insensitive matching. Loaded at chat init, runs before each AI turn.
- **Lorebook editor**: DaisyUI CRUD form. Entries listed as cards with drag-to-reorder. Keyword chip input (add/remove tags). Content textarea with C-237 macro support. Constant toggle per entry. Priority number input.
- **Active Context panel**: DaisyUI drawer accessed from chat toolbar. Shows currently active entries with match reason ("constant" or "matched: 'goblin'"). Highlights new matches with brief animation. Inline entry editing.
- **AI lorebook generator**: Textarea for free-form world notes → LLM call → structured `LorebookEntry[]` output. User reviews + edits before saving.
- **Per-chat lorebook assignment**: Chat metadata stores `activeLorebookIds: string[]`. Only assigned lorebooks are scanned. Assign in chat settings drawer.

## State & Data Models

    interface Lorebook {
        id: string;
        name: string;                // "Forgotten Realms", "Homebrew World"
        description: string;
        entries: LorebookEntry[];
        isBuiltIn: boolean;
        createdAt: string;
        updatedAt: string;
    }

    interface LorebookEntry {
        id: string;
        keywords: string[];          // ["goblin", "Cragmaw", "Redbrand"]
        content: string;             // Macro-enabled: "The {{char}} knows..."
        constant: boolean;           // Always injected if true
        position: 'before' | 'after'; // Where in system prompt
        priority: number;            // Higher = injected first
    }

    interface KeywordMatch {
        entry: LorebookEntry;
        matchedKeyword: string;      // Which keyword triggered
        matchType: 'constant' | 'keyword';
    }

## Scope Boundaries

- **In Scope:**
  - `Lorebook` + `LorebookEntry` data model with Zod schemas
  - Keyword scanner (`scanKeywords()`) — case-insensitive, deduped, priority-sorted
  - Constant entry injection (always in prompt)
  - Keyword-triggered injection (matched in last 10 messages)
  - Lorebook CRUD in ConfigService
  - Lorebook editor ViewModel + views (entry cards, keyword chips, drag-to-reorder, macro content)
  - Active Context panel (drawer showing active entries + match reasons)
  - AI lorebook generator (free-text → structured entries via LLM)
  - Per-chat lorebook assignment (chat metadata `activeLorebookIds`)
  - Integration with `gmPromptService` — lorebook entries injected as `[WORLD INFO]` section
  - Dev sandbox: `/dev/lorebook`
  - Unit tests, Playwright E2E (`tests/client/lorebook.spec.ts`), Visual (`suites/lorebook.visual.ts`), POM (`src/pom/lorebook_page.ts`)
- **Out of Scope:**
  - Lorebook folder organization (flat list only in Phase 1)
  - Lorebook import/export (separate contract)
  - Recursive entry lookup (entries triggering other entries)
  - Knowledge retrieval / RAG vector search (separate future contract)
  - Lorebook-keeper agent (auto-create entries from narrative — future)

## Acceptance Criteria

### AC-1: Lorebook CRUD + Keyword Scanner
**Given** a lorebook with 3 entries (1 constant, 2 keyword-triggered)
**When** `scanKeywords("The goblin scout draws his blade", entries)` is called
**Then** the constant entry + the keyword entry matching "goblin" are returned; the unmatched keyword entry is excluded; results are sorted by priority

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `lorebook_store.test.ts` — CRUD operations; `keyword_scanner.test.ts` — constant always included, case-insensitive match, dedup, priority sort, no false positives on partial word match (optional: "gob" should NOT match "goblin")

### AC-2: Lorebook Editor UI
**Given** the user opens the Lorebook editor from settings
**When** they create a lorebook named "My World", add 2 entries with keywords + content, toggle one as constant, and save
**Then** the lorebook appears in the list; entries persist across reload

**Test Hooks**:
- Unit Test: `lorebook_editor_viewmodel.test.ts` — add/remove entry, keyword chips, drag reorder
- E2E: `tests/client/lorebook.spec.ts` — create lorebook → add entries → verify persist
- Visual: `suites/lorebook.visual.ts` — editor with entries, keyword chips, constant toggle

### AC-3: Active Context Panel + Prompt Injection
**Given** a chat has an assigned lorebook
**When** the player sends a message containing "Cragmaw Castle"
**Then** entries matching "Cragmaw" appear in the Active Context panel; the resolved content is injected into the GM system prompt as `[WORLD INFO]` section

**Test Hooks**:
- E2E: `tests/client/lorebook.spec.ts` — assign lorebook → send message → verify prompt injection → open Active Context → verify matched entries
- Visual: `suites/lorebook.visual.ts` — Active Context panel with matched entries

### AC-4: AI Lorebook Generator
**Given** the user pastes world notes ("The Kingdom of Valdren...") into the generator
**When** "Generate Entries" is clicked
**Then** the LLM produces structured lorebook entries with keywords + content; the user can edit and save them

**Test Hooks**:
- Unit Test: `lorebook_generator.test.ts` — schema validation, min 3 entries produced
- E2E: `tests/client/lorebook.spec.ts` — paste notes → generate → verify entries → save
- Visual: N/A (functional)

### AC-5: Dev Sandbox
**Given** navigate to `/dev/lorebook`
**When** page loads
**Then** split-panel: lorebook list + editor (left), keyword scanner simulator with sample messages (right), Active Context panel, AI generator

**Test Hooks**:
- E2E: functional
- Visual: `suites/lorebook.visual.ts` — sandbox layout

## Implementation Sequence

### Phase 1: Data Layer
1. `Lorebook` + `LorebookEntry` types + Zod schemas in `packages/shared/`
2. `scanKeywords()` pure function
3. Lorebook CRUD in `ConfigService`
4. Unit tests: `lorebook_store.test.ts`, `keyword_scanner.test.ts`, `lorebook_generator.test.ts`

### Phase 2: ViewModel
1. `lorebook_editor_view_model.svelte.ts` — CRUD, entry management, generator
2. Wire `scanKeywords()` + injection into `gmPromptService`
3. Unit test: `lorebook_editor_viewmodel.test.ts`

### Phase 3: Views
1. `lorebook_editor_view.svelte` — DaisyUI form + entry cards
2. `active_context_panel.svelte` — DaisyUI drawer
3. `lorebook_generator.svelte` — AI generator UI
4. Dev sandbox: `/dev/lorebook`

### Phase 4: Validation
1. `moon run client:fix && moon run client:typecheck && moon run client:test`
2. `cd apps/e2e && bun run test && bun run test:visual`

## Edge Cases & Gotchas

- **Token budget**: Active lorebook entries consume prompt tokens. Show total character count in Active Context. Warn if >2KB. Cap at 5KB total for lorebook injection.
- **Keyword matching**: Case-insensitive. Match whole words only (word boundary). "goblin" should NOT match "gob" but SHOULD match "goblins".
- **Dedup priority**: If two entries match the same keyword, both are included. Sorted by priority descending.
- **Macro support**: Entry content goes through C-237's `resolveMacros()` before injection. Context includes character name, location, time.
- **AI generator timeout**: Large world notes → extraction may take 30+ seconds. Show spinner with estimated time.
