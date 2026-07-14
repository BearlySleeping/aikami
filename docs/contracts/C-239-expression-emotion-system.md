## Metadata
<!-- audit: legacy — no execution report -->

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/ROLEPLAY.md` (16 sprite expressions, two-tier detection, expression agent + keyword fallback); TODO.md C-ME-010 |
| **Target** | `apps/frontend/client/src/lib/services/expression/` + `apps/frontend/client/src/lib/views/chat/` — Expression catalog, two-tier detection, LPC overlay mapping, per-message persistence |
| **Priority** | P2 — Expressions bring static LPC sprites to life; key for visual storytelling |
| **Dependencies** | C-158 (LPC Avatar Integration — COMPLETED), C-236 (Agent Pipeline — COMPLETED for expression agent), `expression_asset_resolver.ts` (EXISTS — maps expressions to LPC asset paths), `textGenerationService` (lightweight LLM calls) |
| **Status** | completed |
| **Contract version** | 1.0.0 |

## Overview

Aikami already has the infrastructure: a working LPC avatar system (C-158), an expression asset resolver (`expression_asset_resolver.ts`), and the expression agent defined in C-236's pipeline. What's missing is the expression catalog itself — 16 named expressions with LPC overlay mappings — and the two-tier detection system (LLM agent + keyword regex fallback) that Marinara uses. This contract completes the expression stack: defines the expression catalog, maps each expression to LPC overlay combinations (eyebrow/mouth/eye changes), builds the keyword fallback regex engine for non-LLM mode, and wires per-message persistence so expressions survive swipe/regeneration.

## Design Reference

**Existing code:**
- `apps/frontend/client/src/lib/services/expression/expression_asset_resolver.ts` — maps expression strings to LPC asset paths; extend with 16-expression catalog
- C-236's expression agent — pipeline post-processing slot; this contract provides its prompt template + output schema
- `apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts` — LPC asset IDs (eyes, eyebrows, mouth variants)
- `apps/frontend/client/src/lib/views/combat/components/combat_portrait_stage.svelte` — renders character sprites; expressions update sprite visuals

**Marinara-Engine inspiration:**
- Expression catalog: `examples/Marinara-Engine/docs/ROLEPLAY.md` (16 expressions)
- Two-tier system: LLM expression agent + keyword regex fallback

**Testing conventions:** See `.pi/skills/testing/SKILL.md`.

## Architecture Directives

- **Expression catalog**: 16 expressions from Marinara — `neutral`, `happy`, `sad`, `angry`, `surprised`, `scared`, `embarrassed`, `love`, `thinking`, `laughing`, `worried`, `disgusted`, `smirk`, `crying`, `determined`, `hurt`. Plus 3 combat-specific: `victorious`, `wounded`, `enraged`.
- **Two-tier detection**: Tier 1 = C-236 expression agent (LLM call → structured output with character→expression map). Tier 2 = keyword regex fallback (scans message for emotional keywords, maps to expressions). Tier 1 runs if agent is enabled + connection is available. Tier 2 always runs as fallback.
- **LPC overlay mapping**: Each expression maps to specific LPC asset IDs for eyes, eyebrows, and mouth. Example: `angry` → `eyes/angry` + `eyebrows/furious` + `mouth/grit`. Uses existing `expression_asset_resolver.ts`.
- **Per-message persistence**: Expressions are stored as `expressionMap: Record<string, string>` on each message (characterId → expression). On swipe/regenerate, the expression for that message variant is restored. Persisted in IndexedDB alongside message alternatives (C-231).
- **All client-side**: No backend changes. Expression detection uses existing `textGenerationService.extractStructure()`.

## State & Data Models

    type ExpressionId = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' |
        'scared' | 'embarrassed' | 'love' | 'thinking' | 'laughing' |
        'worried' | 'disgusted' | 'smirk' | 'crying' | 'determined' |
        'hurt' | 'victorious' | 'wounded' | 'enraged';

    interface ExpressionEntry {
        id: ExpressionId;
        label: string;
        keywords: RegExp;           // Tier-2 fallback: /angry|furious|rage|enraged/i
        lpcOverlays: {              // LPC asset suffix overrides
            eyes?: string;           // "angry", "closed", "wide"
            eyebrows?: string;       // "furious", "raised", "sad"
            mouth?: string;          // "grit", "smile", "frown", "open"
        };
    }

    // Per-message persistence:
    // message.expressionMap = { 'npc-goblin': 'angry', 'player': 'surprised' }

## Scope Boundaries

- **In Scope:**
  - 16-expression catalog + 3 combat expressions (19 total)
  - Expression-to-keyword regex map for Tier-2 fallback detection
  - Expression-to-LPC overlay mapping (eyes, eyebrows, mouth per expression)
  - C-236 expression agent prompt template + Zod output schema
  - `detectExpression(message, enabledAgents): ExpressionMap` — two-tier runner
  - Per-message expression persistence on `EnhancedMessage` (C-231)
  - Expression restore on message swipe/regeneration
  - Combat expression triggers: `wounded` on damage, `victorious` on kill
  - Dev sandbox: `/dev/expression`
  - Unit tests, Playwright E2E (`tests/client/expression.spec.ts`), Visual (`suites/expression.visual.ts`), POM (`src/pom/expression_page.ts`)
- **Out of Scope:**
  - Dynamic LPC asset generation (uses existing catalog only)
  - Expression animation/transition effects (instant swap in Phase 1)
  - Background character expressions (only active dialogue participants)
  - Voice tone modulation based on expression

## Acceptance Criteria

### AC-1: Expression Catalog + Keyword Fallback
**Given** the message "I clench my fists and glare at the goblin with fury"
**When** `detectExpression()` runs with agent disabled
**Then** Tier-2 keyword fallback detects `glare|fury` → maps to `angry` expression; LPC overlays for eyebrows and mouth are updated

**Test Hooks**:
- Unit Test: `expression_catalog.test.ts` — all 19 expressions defined with keywords + LPC overlays; `keyword_detection.test.ts` — regex matching per expression, priority rules, multi-character detection, neutral fallback for no-match

### AC-2: LLM Expression Agent (Tier 1)
**Given** the expression agent is enabled (C-236 pipeline)
**When** an AI response is generated
**Then** the agent produces `{ characters: [{ name: 'Goblin', expression: 'angry' }] }`; LPC overlays update; if agent fails, Tier-2 keyword fallback runs

**Test Hooks**:
- Unit Test: `expression_agent.test.ts` — prompt template produces valid output; schema validates; failure → fallback
- E2E: `tests/client/expression.spec.ts` — send message → verify expression changes on portrait stage
- Visual: `suites/expression.visual.ts` — portraits with different expressions

### AC-3: Combat Expressions
**Given** combat is active
**When** the player takes damage or defeats an enemy
**Then** `wounded` expression triggers on player damage; `victorious` on enemy defeat; `enraged` on critical hit

**Test Hooks**:
- E2E: `tests/client/expression.spec.ts` — enter combat → verify expression changes on damage/kill
- Visual: N/A (timing-dependent)

### AC-4: Per-Message Persistence
**Given** an AI message has expression data
**When** the player swipes to an alternate response (C-231)
**Then** the alternate response restores its own expression data; swiping back restores the original

**Test Hooks**:
- Unit Test: `expression_persistence.test.ts` — expression stored per-message-alternative; restore on swipe
- E2E: `tests/client/expression.spec.ts` — regenerate → swipe → verify expression changes with message

### AC-5: Dev Sandbox
**Given** navigate to `/dev/expression`
**When** page loads
**Then** text input + live expression preview on a mock LPC portrait, expression catalog browser, keyword test area, agent enable/disable toggle

**Test Hooks**:
- E2E: functional
- Visual: `suites/expression.visual.ts` — sandbox with portrait + expression selection

## Implementation Sequence

### Phase 1: Data Layer
1. Define 19-expression catalog with keywords + LPC overlay mappings
2. Extend `expression_asset_resolver.ts` with catalog
3. `detectExpression()` two-tier runner
4. Expression agent prompt template + Zod schema
5. Unit tests: `expression_catalog.test.ts`, `keyword_detection.test.ts`, `expression_agent.test.ts`, `expression_persistence.test.ts`

### Phase 2: Integration
1. Wire C-236 expression agent with prompt + schema
2. Wire per-message persistence into C-231's `EnhancedMessage`
3. Wire expression restore on swipe/regeneration
4. Wire combat expression triggers into `CombatViewModel`

### Phase 3: Views
1. Update `combat_portrait_stage.svelte` to read expression overlays
2. Dev sandbox: `/dev/expression`

### Phase 4: Validation
1. `moon run client:fix && moon run client:typecheck && moon run client:test`
2. `cd apps/e2e && bun run test && bun run test:visual`

## Edge Cases & Gotchas

- **Keyword priority**: Multiple keywords matching different expressions → use the first match in the message (most relevant context). If ambiguous, fall back to `neutral`.
- **Expression agent cost**: The agent LLM call is small (~200 tokens). If the main model is expensive, route the expression agent through a cheaper connection (C-230).
- **LPC overlay fallback**: If an overlay asset doesn't exist (e.g., `eyebrows/furious` not in catalog), skip that overlay — don't crash. Log a warning.
- **Multi-character expressions**: The agent output is `{ characters: [{ name, expression }] }`. Only update expressions for characters currently visible on screen.
