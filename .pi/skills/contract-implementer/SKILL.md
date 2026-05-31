---
name: contract-implementer
description: >-
  Implements Aikami features from contract specifications in the docs/ repo (cloned inside main repo, gitignored).
  Steps: read contract then implement code then run fix+typecheck then write tests then verify then log findings then archive contract.
  Use when implementing features defined in docs/contracts/*.md. Tracks progress in docs/contracts/PROGRESS.md.
---

# Contract Implementer

Implements Aikami features from the `docs/` repo (cloned inside main repo at `docs/`, gitignored). Each contract is a complete feature spec with data model, acceptance criteria, test hooks, visual criteria, implementation notes, and edge cases.

## Workflow

### Phase 1: Load & Analyze

1. Read `docs/contracts/INDEX.md` to see current priority ranking
2. Read `docs/contracts/PROGRESS.md` to see what's in progress / completed
3. Pick the next available contract (lowest rank number, not completed or in-progress)
4. Read the contract fully
5. Run `moon_detect_affected` to understand what packages are currently changed
6. Log initial analysis in PROGRESS.md

### Phase 2: Implement

For each acceptance criterion in the contract:
1. Create/modify files per the Implementation Notes section
2. Follow Aikami conventions: snake_case files, ViewModel pattern, Svelte 5 runes
3. Use `:affected` variants for fix/typecheck (don't run on unchanged projects)
4. Commit logical groups — one commit per AC or per file group

### Phase 3: Verify

After implementation:
1. Run `validate({ test: true })` — runs fix+typecheck on affected projects, then build+test
2. If errors: fix and re-run until clean
3. Check each AC manually: does the feature behave as specified?

### Phase 4: Log & Archive

1. Update `docs/contracts/PROGRESS.md`:
   - Mark contract as `completed`
   - Log findings, gotchas encountered, files created/modified
   - Note any deviations from the contract
   - Record limitations or future work
2. Add `<!-- completed: YYYY-MM-DD -->` comment at top of the contract file
3. Update `docs/contracts/INDEX.md` status from `not_started` → `completed`
4. Run `cd docs && bun run scripts/generate_llms_txt.ts` to update the index

### Phase 5: Continue

1. Pick next contract from INDEX.md priority ranking
2. Start from Phase 1

## Key Rules

### ALWAYS use validate() extension
```
validate({ test: true })  # fix+typecheck+build+test on affected projects
```

### ALWAYS use moon for task execution
```
moon_run_task({ target: "pwa:typecheck" })  # NOT cd apps/frontend/pwa && bun run typecheck
```

### NEVER push without explicit instruction
Keep changes in working tree. Only commit+push when told.

### File naming
All source files: snake_case. Enforced by Biome.

### ViewModel pattern
Each view gets a `{name}_view_model.svelte.ts` file exporting an interface and a class. No `vm` shorthand.

### Callable functions
Follow the 4-layer typed pattern:
1. Types in `packages/shared/types/src/lib/api/{name}.ts`
2. Registry in `callable_functions.ts`
3. Controller in `apps/backend/functions/src/controllers/callable/{name}.ts`
4. Frontend via `firebaseFunctionsService.getTypedCallable('name')`

### Contract → Route mapping
```
pwa-* contracts      → apps/frontend/pwa/src/routes/(authenticated)/{path}/
landing-* contracts  → apps/frontend/landing/src/pages/{path}.astro
shared-* contracts   → packages/shared/{types,schemas}/
                       packages/backend/{ai,database,utils}/
functions-* contracts → apps/backend/functions/src/
```

## PROGRESS.md Format

```markdown
# Contract Implementation Progress

## Current: {contract_name} — {phase} — {model}
Started: YYYY-MM-DD HH:MM
Last activity: YYYY-MM-DD HH:MM

### Findings
- {finding}

### Files modified
- {path} — {description}

### AC Status
- [ ] AC-1: {name}
- [x] AC-2: {name}
```

## Contracts Location

All contracts live in `docs/contracts/`. The `docs/` folder is a separate git repo (gitignored in main).

## Contracts Priority Ranking

Read `docs/contracts/INDEX.md` for the current priority ranking. It is always the source of truth. Do not hardcode contract lists — they go stale.
