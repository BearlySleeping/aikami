## Metadata

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/MACROS.md` (full macro reference — identity, character, context, time, random, variables, formatting, conditionals); TODO.md C-ME-008 |
| **Target** | `packages/shared/parser/src/lib/macro_resolver.ts` + `apps/frontend/client/src/lib/views/presets/` — Macro resolution engine, template preset system, macro autocomplete, prompt preview |
| **Priority** | P1 — Macros make prompts dynamic and reusable; reduces prompt engineering overhead across all AI interactions |
| **Dependencies** | `@aikami/parser` package (EXISTS — `extractMacros`, `parseLine`, `parseStreamChunk`, `MacroNode`), `configService` (character/connection data), `characterSheetService` (C-232 — COMPLETED), `gameStateService` (time/weather/location), `diceService` (dice rolls) |
| **Status** | completed (2026-07-09) |
| **Contract version** | 1.0.0 |

## Overview

Aikami's `@aikami/parser` package already extracts macros from text (`extractMacros`, `parseLine`, `parseStreamChunk`) but has no resolution engine — macros like `{{user}}` or `{{random::sword::shield}}` are detected but never replaced with actual values. Marinara-Engine's macro system provides a comprehensive resolver covering identity, character fields, context, time, random (including weighted random), variables, formatting, and conditionals. This contract builds the `resolveMacros()` engine in the shared parser package and adds a template preset system (save/load named prompt templates), macro autocomplete in the chat input, and a prompt preview debug panel.

## Design Reference

**Existing code to extend:**
- `packages/shared/parser/src/lib/lexer.ts` — `extractMacros()`, `stripMacros()`, `hasUnclosedMacro()`, `tokenizeLine()` — already extracts `MacroNode` AST nodes
- `packages/shared/parser/src/lib/parser.ts` — `parseLine()`, `parseStreamChunk()`, `createStreamBuffer()` — stream-aware parsing
- `packages/shared/parser/src/lib/types.ts` — `MacroNode` type with `name` and `args`
- `packages/shared/parser/src/index.ts` — barrel exports
- `apps/frontend/client/src/lib/views/chat/chat_view_model.svelte.ts` — uses `parseLine()` for slash commands, `parseStreamChunk()` for macros in AI responses
- `apps/frontend/client/src/lib/services/config/config_service.svelte.ts` — provides character data, connection model, active persona
- `apps/frontend/client/src/lib/data/ai_prompts/world_gen_system_prompt.ts` — GM system prompt template (will be macro-enabled)

**Marinara-Engine inspiration:**
- `examples/Marinara-Engine/docs/MACROS.md` — full macro catalog
- `examples/Marinara-Engine/packages/shared/src/utils/macro-engine.ts` — `resolveMacros()` implementation

**Testing conventions:** See `.pi/skills/testing/SKILL.md`.

## Architecture Directives

- **Macro resolver**: New pure function `resolveMacros(template: string, context: MacroContext): string` in `packages/shared/parser/src/lib/macro_resolver.ts`. No side effects. Resolves `{{macro}}` patterns against the provided context. Unknown macros are left unchanged. Nested macros are supported (inner resolved first).
- **Macro catalog** (Phase 1): identity (`{{user}}`, `{{char}}`, `{{persona}}`), character fields (`{{description}}`, `{{personality}}`, `{{traits}}`), context (`{{input}}`, `{{model}}`, `{{chatId}}`), time (`{{date}}`, `{{time}}`, `{{datetime}}`), random (`{{random}}`, `{{random::A::B::C}}`, `{{random::A@2::B@0.5}}` weighted, `{{roll:2d6}}`), variables (`{{getvar}}`, `{{setvar}}`, `{{incvar}}`), formatting (`{{trim}}`, `{{uppercase}}...{{/uppercase}}`, `{{#if}}...{{/if}}` conditionals).
- **Template preset system**: Stored in `ConfigService` as `PromptPreset[]`. Each preset has `name`, `sections[]` (each with `label`, `content` with macros, `position`), and `generationParams` override. Presets can be applied to chats. Drag-and-drop section ordering in editor.
- **Macro autocomplete**: In any text input bound to prompt editing, typing `{{` opens a DaisyUI dropdown of available macros with descriptions. Selecting a macro inserts it.
- **Prompt peek**: Button in chat settings or dev tools that shows the fully assembled and resolved prompt — all macros resolved, all sections merged. Critical for debugging.

## State & Data Models

    // ── Macro Context (passed to resolver) ──────────────────

    interface MacroContext {
        user?: string;
        char?: string;
        persona?: string;
        description?: string;
        personality?: string;
        backstory?: string;
        traits?: string;             // C-232 serialization
        input?: string;
        model?: string;
        chatId?: string;
        variables?: Record<string, string | number>;
    }

    // ── Template Preset ─────────────────════════════════════

    interface PromptSection {
        id: string;
        label: string;               // "System Prompt", "Character Context", "Rules"
        content: string;             // Macro-enabled text
        position: number;            // Order in the assembled prompt
    }

    interface PromptPreset {
        id: string;
        name: string;                // "Default", "Creative GM", "Combat Focus"
        sections: PromptSection[];
        generationParams?: { temperature?: number; maxTokens?: number; };
        isBuiltIn: boolean;
    }

    // ── Built-in Presets ─────────────────═══════════════════

    const BUILT_IN_PRESETS: PromptPreset[] = [
        {
            id: 'default', name: 'Default RPG',
            sections: [
                { label: 'System Prompt', content: 'You are the Game Master. {{persona}}', position: 0 },
            ],
            isBuiltIn: true,
        },
        { id: 'combat', name: 'Combat Focus',
          sections: [{ label: 'Combat Rules', content: 'Run combat strictly. {{traits}}', position: 0 }],
          isBuiltIn: true },
    ];

## Scope Boundaries

- **In Scope:**
  - `resolveMacros(template, context)` pure function in shared parser package
  - Identity macros: `{{user}}`, `{{char}}`, `{{persona}}`, `{{charName}}`
  - Character macros: `{{description}}`, `{{personality}}`, `{{backstory}}`, `{{traits}}` (C-232 serialization)
  - Context macros: `{{input}}`, `{{model}}`, `{{chatId}}`
  - Time macros: `{{date}}`, `{{time}}`, `{{datetime}}`, `{{weekday}}`
  - Random macros: `{{random}}` (0-100), `{{random::A::B::C}}` (pick one), `{{random::A@2::B@0.5}}` (weighted), `{{roll:2d6}}` (dice)
  - Variable macros: `{{getvar::name}}`, `{{setvar::name::value}}`, `{{incvar::name}}`, `{{decvar::name}}`
  - Formatting macros: `{{trim}}`, `{{uppercase}}...{{/uppercase}}`, `{{lowercase}}...{{/lowercase}}`, `{{#if var == "value"}}...{{/if}}`
  - Nested macro resolution (inner resolves first)
  - `PromptPreset` CRUD in ConfigService (save/load/delete/duplicate)
  - Preset editor ViewModel + views: section list, drag-to-reorder, macro-enabled textareas
  - Macro autocomplete dropdown triggered by `{{` in preset editor and chat input
  - Prompt peek/preview modal showing fully assembled + resolved prompt
  - Dev sandbox: `/dev/macros`
  - Unit tests, Playwright E2E (`tests/client/macro_system.spec.ts`), Visual (`suites/macro_system.visual.ts`), POM (`src/pom/macro_system_page.ts`)
- **Out of Scope:**
  - Custom agent prompt integration (C-ME-018)
  - Lorebook macro integration (C-ME-009)
  - Regex scripts (separate contract)
  - Macro exporting/sharing

## Acceptance Criteria

### AC-1: Macro Resolution Engine
**Given** a template `"{{user}} enters the {{random::tavern::dungeon::forest}}"`
**When** `resolveMacros(template, { user: 'Aldric' })` is called
**Then** the output is `"Aldric enters the tavern"` (or dungeon/forest randomly); unknown macros like `{{unknown}}` remain unchanged; nested macros resolve from inner to outer

**Test Hooks**:
- Moon Task: `moon run parser:test`
- Unit Test: `macro_resolver.test.ts` — test all macro categories: identity, character, context, time, random, random weighted, dice roll, variables (setVar then getVar), formatting (trim, uppercase, lowercase), conditionals (true/false branches), nested macros, unknown passthrough

### AC-2: Template Preset CRUD
**Given** the user opens the Presets panel in settings
**When** they create a preset named "Dark Fantasy GM", add 2 sections, and save
**Then** the preset appears in the list, survives page reload, and can be applied to a chat (sets the chat's active preset)

**Test Hooks**:
- Unit Test: `preset_store.test.ts` — CRUD operations, built-in immutability, duplicate, apply to chat
- E2E: `tests/client/macro_system.spec.ts` — create/edit/delete preset, apply to chat, verify sections injected into prompt

### AC-3: Macro Autocomplete
**Given** the user types `{{` in a prompt editor textarea
**When** the autocomplete dropdown appears
**Then** it lists available macros with name + description; typing filters the list; selecting a macro inserts it (e.g., `{{user}}`); pressing Escape closes the dropdown

**Test Hooks**:
- Unit Test: `macro_autocomplete.test.ts` — filter, select, close, position tracking
- E2E: `tests/client/macro_system.spec.ts` — type `{{us` → verify dropdown shows `{{user}}` → select → verify inserted

### AC-4: Prompt Preview
**Given** a chat has an active preset with macros
**When** the user clicks "Preview Prompt" in chat settings
**Then** a modal shows the fully assembled system prompt with all macros resolved, sections merged in order, and a character count

**Test Hooks**:
- E2E: `tests/client/macro_system.spec.ts` — apply preset → click Preview → verify resolved text, character count
- Visual: `suites/macro_system.visual.ts` — preview modal with resolved macros

### AC-5: Dev Sandbox
**Given** navigate to `/dev/macros`
**When** page loads
**Then** split-panel: template editor (left) with macro autocomplete, live resolution output (right), preset list with CRUD, context mock fields

**Test Hooks**:
- E2E: functional
- Visual: `suites/macro_system.visual.ts` — sandbox with live resolution

## Implementation Sequence

### Phase 1: Data Layer
1. `resolveMacros()` in `packages/shared/parser/src/lib/macro_resolver.ts` — all macro categories
2. `PromptPreset` types + Zod schemas
3. Preset CRUD in `ConfigService`
4. Unit tests: `macro_resolver.test.ts`, `preset_store.test.ts`, `macro_autocomplete.test.ts`

### Phase 2: ViewModel
1. `preset_editor_view_model.svelte.ts` — CRUD, section reordering
2. `prompt_preview_view_model.svelte.ts` — assembly + resolution
3. Wire `resolveMacros()` into `gmPromptService` (C-235) and `DialogueOverlayViewModel`

### Phase 3: Views
1. `preset_editor_view.svelte` — DaisyUI form
2. `macro_autocomplete.svelte` — dropdown component
3. `prompt_preview_modal.svelte` — resolved prompt display
4. Dev sandbox: `/dev/macros`

### Phase 4: Validation
1. `moon run parser:test && moon run client:fix && moon run client:test`
2. `cd apps/e2e && bun run test && bun run test:visual`

## Edge Cases & Gotchas

- **Nested macro ordering**: `{{uppercase}}{{random::sword::shield}}{{/uppercase}}` → resolve random first, THEN uppercase the result
- **Weighted random edge cases**: All-zero weights → return empty string. Invalid weight suffix (e.g., `@rare`) → treat as literal text
- **Variable scope**: Variables are per-template-invocation — not shared across calls. `{{setvar}}` modifies the context for subsequent macros in the same template.
- **Conditional syntax**: `{{#if var == "value"}}...{{else}}...{{/if}}`. Only `==` operator in Phase 1. Case-sensitive comparison. No nested conditionals in Phase 1.
- **Unknown macros**: Pass through unchanged — don't strip them. This allows the LLM to see unresolved macros and potentially handle them.
- **Circular macro references**: `{{getvar::x}}` where x was set by something that reads x — detect cycles (max 10 resolution passes) and break with `[CIRCULAR]`.
