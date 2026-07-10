---
name: contract-implementer
description: >-
  Implements Aikami features from contract specifications in docs/contracts/ (docs/ is a separate repo cloned inside main, gitignored).
  Flow: plan → implement → QA (sandbox + E2E + visual) → validate → docs → archive. Use when implementing features
  defined in docs/contracts/*.md. PROGRESS.md is auto-generated via `bun knowledge:sync`; INDEX.md is read-only;
  execution reports live at the bottom of individual contract files.
---

# Contract Implementer

The authoritative phase-by-phase flow lives in the `/contract` prompt (`.pi/prompts/contract.md`). This skill carries the supporting reference material.

## Sources of Truth

| File | Role | Writable? |
|---|---|---|
| `docs/contracts/C-*.md` | Contract spec + execution report at bottom | ✅ (completion marker, Status field, report) |
| `docs/contracts/INDEX.md` | Priority ranking | 🔴 READ-ONLY — never edit |
| `docs/contracts/PROGRESS.md` | Status dashboard | 🔴 AUTO-GENERATED — run `bun knowledge:sync`, never hand-edit |

## Completion Protocol

1. `<!-- completed: YYYY-MM-DD -->` as FIRST line of the contract file.
2. `**Status**` metadata field → `completed`.
3. Execution Report appended to the BOTTOM of the contract file:
   - Summary (2-4 sentences)
   - AC Status table (per-AC ✅/⚠️ with one-line note — be honest about partials)
   - Files created / modified tables
   - Deviations from spec + rationale
   - Test results (unit / E2E / visual, with counts)
4. `bun knowledge:sync` to regenerate PROGRESS.md.

## QA Requirements (not optional)

A contract with UI is NOT complete without:
- Dev sandbox page at `apps/frontend/client/src/routes/(dev)/dev/<feature>/+page.svelte` — thin page mounting a `$views/dev/*` view + ViewModel factory
- Live verification: `herdr_session restart client` (after adding routes) → `browser_screenshot` → `ai_validate_image` (score ≥ 80)
- Playwright spec in `apps/e2e/tests/client/` using `$pom` POMs
- Visual suite in `apps/e2e/src/visual/suites/*.visual.ts` (`defineConfig` + `export default`)

See `.pi/skills/testing/SKILL.md` for suite/POM patterns and run commands.

## Docs Decision

- User-facing feature → short page (1-3 paragraphs, link to source) in `apps/frontend/docs/src/content/docs/`
- Internal/refactor/infra → contract execution report only, no docs page

## Callable Functions (4-layer typed pattern)

1. Types: `packages/shared/types/src/lib/api/{name}.ts`
2. Registry: `callable_functions.ts`
3. Controller: `apps/backend/firebase/src/controllers/callable/{name}.ts`
4. Frontend: `firebaseFunctionsService.getTypedCallable('name')`

## Contract → Location Mapping

```
client-*    → apps/frontend/client/src/
site-*      → apps/frontend/site/src/
shared-*    → packages/shared/{types,schemas,constants}/
backend-*   → packages/backend/{ai,auth,chat,database,utils}/
firebase-*  → apps/backend/firebase/src/
```

## Key Rules

- `validate({ test: true })` for final verification; `moon_run_task` for per-project fix/typecheck
- Never commit or push without explicit instruction
- One contract at a time; report failures honestly
- Route groups use literal parens: `(dev)` — quote in bash, never backslash-escape
