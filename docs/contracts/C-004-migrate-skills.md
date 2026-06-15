## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami `.agents/skills/` + Aikami `.pi/skills/` |
| **Target** | `/aikami/.pi/skills/` |
| **Priority** | P0 — Skills must be available to pi BEFORE any feature work |
| **Dependencies** | C-001 (clean root), C-003 (.pi directory) |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

Migrate all aikami-specific skills from `.agents/skills/` to `.pi/skills/`, and supplement with core engineering skills from aikami. The `impeccable` design skills stay (they're aikami-specific), while aikami contributes engineering skills like `project-commands`, `firestack`, `contract-implementer`, `knowledge-clerk`, and `firebase-functions`.

## Design Reference

**Aikami current skills** (`.agents/skills/`):
- adapt, animate, audit, bolder, clarify, colorize, critique, delight, distill, extract, frontend-design, harden, impeccable, normalize, onboard, optimize, polish, quieter, teach-impeccable
- These are ALL from the `pbakaus/impeccable` skill pack — design-focused

**Aikami skills** (`.pi/skills/`):
- `contract-implementer` — Implements features from contracts
- `firebase-functions` — Firebase Cloud Functions conventions
- `firestack` — Firebase CLI operations
- `firestore-collection` — Firestore collection scaffolding
- `genkit-rules` — Genkit conventions (SKIP for aikami)
- `knowledge-clerk` — Knowledge base maintenance
- `aikami-conventions` → `aikami-conventions` — Project-specific conventions
- `project-commands` — Build/test/lint commands
- `svelte-page` — SvelteKit page scaffolding

## Skills Mapping

| Source | Skill | Destination | Action |
|--------|-------|-------------|--------|
| `.agents/skills/` | All 19 impeccable skills | `.pi/skills/` | MOVE (not copy) |
| Aikami `.pi/skills/` | `project-commands` | `.pi/skills/` | COPY + adapt |
| Aikami `.pi/skills/` | `firestack` | `.pi/skills/` | COPY |
| Aikami `.pi/skills/` | `firebase-functions` | `.pi/skills/` | COPY + adapt |
| Aikami `.pi/skills/` | `firestore-collection` | `.pi/skills/` | COPY |
| Aikami `.pi/skills/` | `contract-implementer` | `.pi/skills/` | COPY + adapt |
| Aikami `.pi/skills/` | `knowledge-clerk` | `.pi/skills/` | COPY + adapt |
| Aikami `.pi/skills/` | `svelte-page` | `.pi/skills/` | COPY + adapt |
| Aikami `.pi/skills/` | `aikami-conventions` | `.pi/skills/aikami-conventions` | COPY + rewrite |
| Aikami `.pi/skills/` | `genkit-rules` | — | SKIP (aikami doesn't use Genkit) |

## Acceptance Criteria

### AC-1: All Impeccable Skills Moved to .pi/skills
**Given** 19 skills exist in `.agents/skills/`
**When** migration is complete
**Then** all 19 skills exist in `.pi/skills/` and `.agents/` directory no longer exists

**Test Hooks**:
- Unit: `find .pi/skills -name 'SKILL.md' | wc -l` >= 19
- Unit: `test ! -d .agents`

### AC-2: Engineering Skills Copied from Aikami
**Given** aikami has engineering skills at `.pi/skills/`
**When** skills are copied
**Then** at minimum `project-commands`, `firestack`, `firebase-functions`, `contract-implementer`, `knowledge-clerk`, `svelte-page`, and `aikami-conventions` exist in `.pi/skills/`

**Test Hooks**:
- Unit: `test -f .pi/skills/project-commands/SKILL.md`
- Unit: `test -f .pi/skills/firestack/SKILL.md`
- Unit: `test -f .pi/skills/aikami-conventions/SKILL.md`

### AC-3: Skills Adapted for Aikami
**Given** skills copied from aikami reference `@aikami/` package scope and aikami-specific paths
**When** adaptation is complete
**Then** all references use `@aikami/` package scope, aikami paths, and aikami project structure

**Test Hooks**:
- Unit: `grep -r '@aikami/' .pi/skills/` returns no results
- Unit: `grep -r 'aikami' .pi/skills/aikami-conventions/` returns no results (except in the skill description itself)

### AC-4: aikami-conventions Skill Created
**Given** aikami has an AGENTS.md with project conventions
**When** the skill is created
**Then** `.pi/skills/aikami-conventions/SKILL.md` encodes all conventions from AGENTS.md plus aikami-intro conventions (file naming, code patterns, contract format)

**Test Hooks**:
- Unit: Skill references SvelteKit 2, Svelte 5 runes, ViewModel pattern, Zod, Firebase
- Unit: Skill includes file path comment convention

## Implementation Notes

1. **Move, don't copy**: `mv .agents/skills/* .pi/skills/` — these are aikami-specific and should only exist once
2. **Then copy from aikami**: `cp -r aikami/.pi/skills/{project-commands,firestack,firebase-functions,firestore-collection,contract-implementer,knowledge-clerk,svelte-page} aikami/.pi/skills/`
3. **Adaptation needed**:
   - `project-commands`: Update moon project names (client, functions, etc.)
   - `firebase-functions`: Update paths and function names
   - `contract-implementer`: Update to reference `@aikami/` packages
   - `knowledge-clerk`: Update knowledge directory paths
   - `svelte-page`: Update to use aikami ViewModel pattern, path aliases
4. **aikami-conventions**: Write fresh, incorporating AGENTS.md content plus aikami's agent guidelines
5. **Remove .agents/**: After successful migration, `rm -rf .agents`
6. **Genkit skip confirmed**: Aikami uses Firebase but NOT Genkit — skip genkit-rules

## Edge Cases & Gotchas

- **Impeccable skill references**: Some impeccable skills may reference paths or tools that need updating for the new monorepo structure
- **Skill lock file**: Remove `skills-lock.json` from root (it's a pi skills install artifact, not needed for project-local skills)
- **Duplicate skills**: Ensure no skill exists in both old and new locations after migration
