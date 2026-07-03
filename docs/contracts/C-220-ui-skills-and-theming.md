<!-- completed: 2026-07-04 -->

## Metadata

| Field | Value |
|---|---|
| **Source** | UI Component System Architecture Review & C-219 |
| **Target** | `.pi/skills/aikami-ui/SKILL.md` — AI UI/Theming Guidelines |
| **Priority** | P1 — Prevents AI regression and hallucinated UI components |
| **Dependencies** | C-219 |
| **Status** | ✅ completed |
| **Contract version** | 1.0.0 |

## Overview

This contract establishes a dedicated `.pi/skills/aikami-ui/SKILL.md` file to instruct AI models (specifically DeepSeek v4 Pro) on the project's exact UI and theming architecture. It dictates when to use raw DaisyUI vs. `@aikami/frontend-components`, strictly bans arbitrary inline typography/colors, and enforces the use of `apps/frontend/client/src/app.css` for global changes.

## Design Reference

Reference the conclusions from the "AI-Driven Svelte UI Architecture Report" (Hybrid Shadcn Pattern). 
Reference `.pi/skills/aikami-conventions/SKILL.md` for formatting and tone of skill files.

## Architecture Directives

1. **Create Skill File**: Create a new file at `.pi/skills/aikami-ui/SKILL.md`.
2. **Update Conventions**: Modify `.pi/skills/aikami-conventions/SKILL.md` to add `aikami-ui` to the "For framework-specific patterns, also load:" table.

## State & Data Models

    // Expected Frontmatter for the new SKILL.md
    ---
    name: aikami-ui
    description: >-
        Load for any frontend UI, styling, or Tailwind/DaisyUI tasks. Dictates
        when to use raw HTML vs @aikami/frontend-components, strict typography,
        semantic colors, and where global CSS lives.
    version: 1.0.0
    tags: ["aikami", "ui", "tailwind", "daisyui", "components", "frontend"]
    ---

## Scope Boundaries

- **In Scope:**
    - Creating `.pi/skills/aikami-ui/SKILL.md`.
    - Adding rules for: Primitive vs Complex Components, Typography (`font-mono`/`font-sans`), Semantic Colors vs Hex, and Global CSS modification routing (`app.css`).
    - Updating the table in `.pi/skills/aikami-conventions/SKILL.md`.
- **Out of Scope:**
    - Touching any actual application code, Svelte views, or CSS files.

## Acceptance Criteria

### AC-1: UI Skill File Created
**Given** an AI tool operating in the monorepo
**When** loading the `aikami-ui` skill
**Then** the AI receives explicit instructions to never wrap primitive DaisyUI elements, to use `<Select>` from `@aikami/frontend-components`, to only use `font-mono`/`font-sans`, and to never use hardcoded hex colors instead of semantic DaisyUI tokens.

**Test Hooks**:
- Moon Task: N/A
- Integration: N/A
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: N/A

### AC-2: Conventions Updated
**Given** the main `aikami-conventions` skill file
**When** viewing the framework-specific patterns table
**Then** `aikami-ui` is listed with a clear description of when to load it.

## Implementation Sequence

1. **Phase 1 (Drafting)**: Write the `.pi/skills/aikami-ui/SKILL.md` file using strong, declarative, negative-constraint prompting (e.g., "NEVER use arbitrary fonts like `font-['Inter']`").
2. **Phase 2 (Linking)**: Inject the reference into `.pi/skills/aikami-conventions/SKILL.md`.

## Edge Cases & Gotchas

- **Token Economy**: Keep the skill file concise. Bullet points and strict dos/don'ts are better than long paragraphs. AI needs to scan this quickly.

---

## Execution Report — 2026-07-04

### Summary
Created `.pi/skills/aikami-ui/SKILL.md` with 5 rules governing primitive vs complex component usage, typography enforcement (`font-mono`/`font-sans`), semantic DaisyUI color tokens (no hex), global CSS routing (`app.css`), and DaisyUI plugin positioning. Added `aikami-ui` to the framework-specific patterns table in `.pi/skills/aikami-conventions/SKILL.md`.

### AC Status
| AC | Description | Status |
|----|-------------|--------|
| AC-1 | UI skill file created with component/typography/color/CSS rules | ✅ Pass |
| AC-2 | Conventions updated with aikami-ui table entry | ✅ Pass |

### Files Created
- `.pi/skills/aikami-ui/SKILL.md` — AI UI/Theming skill with 5 rules (Primitive vs Complex, Typography, Semantic Colors, Global CSS, Plugin Positioning) plus quick-reference cheatsheet

### Files Modified
- `.pi/skills/aikami-conventions/SKILL.md` — Added `aikami-ui` row to framework-specific patterns table between `tauri-v2` and `pixijs-v8`

### Deviations
None.

### Test Results
- No application code changed — no typecheck/build/test needed
- Moon detect: no affected projects (skill files only)

### Notes
- The contract is in-scope (skill files only, no application code)
- Skill file follows the same frontmatter + rules format as `aikami-conventions`
- DaisyUI semantic token reference table included for AI quick reference
