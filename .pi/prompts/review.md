---
description: Review staged changes before commit — contract-aware, diff-focused, evidence check
argument-hint: "[optional: contract ID, e.g. 'C-313' or focus area, e.g. 'client']"
---

# Pre-Commit Review

Focus: $ARGUMENTS

You are reviewing staged changes before committing. Do NOT review unstaged or untracked files — only what `git diff --cached` shows. The implementer should have staged exactly the contract's files and nothing else.

## Phase 1: Gather the Change Set

1. Staged diff only:
   ```bash
   git diff --cached --stat
   git diff --cached --name-only
   ```
2. Check for unrelated files:
   ```bash
   git diff --cached --name-only | grep -v -E '^(apps|packages|scripts|docs)/' || echo "All staged files in expected paths"
   ```
3. List untracked files that might belong:
   ```bash
   git ls-files --others --exclude-standard
   ```

**If staged diff is empty**: "Nothing staged for commit. Stage files first with `git add <files>`."

**If unrelated files are staged**: Flag them immediately. Only contract-related changes should be staged.

**If a contract ID is provided**: Cross-reference staged files against the contract's In Scope list. Flag files outside scope.

## Phase 2: Convention Audit

Load `aikami-conventions`. Check every staged file for:

- **snake_case file names** — Biome enforces, but verify
- **`$logger` alias** — no `@aikami/logger` imports
- **Package-root imports** — no `lib/` sub-path imports
- **Types/schemas/constants in `packages/shared/`** — not in `apps/`
- **`type` aliases, never `interface`**
- **No `any`, `null`, non-null `!`**
- **Arrow functions** for module-level, regular methods for classes
- **Private `_` prefix** on all private members
- **No manual `this.debug()` at class method entry** — auto-logged by `create()`

### Svelte-specific (if staged files include `apps/frontend/client/`)
Load `svelte-conventions`. Check:
- No `+server.ts`, `+page.server.ts`, `+layout.server.ts`
- ViewModels: thin bridges, factory export, no repository/Firestore/ticker imports
- No `pixi.js` / `@pixi/` imports in ViewModels or `.svelte` files
- No `app.ticker.add` outside `packages/frontend/engine/`

### Backend-specific (if staged files include `apps/backend/`)
Load `backend-conventions`. Check:
- Controller → Service → Repository layering
- Repository constructor injection
- TypeBox schemas in `packages/shared/schemas/`, not in service files

### General
- No leftover debug code, commented-out blocks, or `console.log`
- No empty directories staged
- No generated files staged (check `.gitignore` patterns)
- No secrets or API keys in plaintext

## Phase 3: Contract Evidence (if contract ID provided)

1. Read the contract file from `docs/contracts/C-XXX-....md`.
2. Check the execution report:
   - Every AC in the contract must appear in the AC Status table
   - No aspirational ✅ — if a test failed and the report marks it ✅, flag it
   - Deviations must have corresponding Amendment entries
3. Cross-check declared test files against disk:
   ```bash
   # For each test file declared in the contract
   ls -la <test-file-path>
   ```
   Flag any declared file that doesn't exist.
4. Check PROGRESS.md:
   - Contract ID appears exactly once
   - Status matches the contract's `**Status**` field
5. Run the contract linter:
   ```bash
   bun run scripts/src/lib/ops/lint_contracts.ts
   ```
   Flag any new lint issues introduced by this contract.

## Phase 4: Migration & Rollback (if applicable)

If the diff shows:
- Schema changes (new/modified TypeBox schemas in `packages/shared/schemas/`)
- Route changes (new/modified `+page.svelte`, `+layout.svelte`)
- Provider/config changes (new/modified constants in `packages/shared/constants/`)
- Firestore index or rule changes

Then:
- Does the contract's Migration & Rollback section address them?
- Is old data compatible?
- Is there a feature flag or rollback path?

## Phase 5: Test Verification

1. Run the specific tests declared in the contract's Evidence Matrix:
   ```bash
   bun moon run <project>:test -- -- --testPathPattern="<test file>"
   ```
2. Record exact PASS/FAIL/SKIPPED counts.
3. Compare against the execution report's test results. Discrepancies = flag.
4. Run `validate({ test: true })` on affected projects. New failures = flag.

## Phase 6: Summary

Produce a structured summary:

```markdown
## Pre-Commit Review: {PASS | CHANGES_REQUESTED}

### Change Summary
- {N} files changed, {N} added, {N} deleted
- {Brief description of what changed and why}

### Convention Violations
- {File:line — issue} or "None"

### Contract Evidence (if C-XXX)
- AC Status: {N}/{total} passing, {N} with warnings
- Test files: {N}/{total} exist on disk
- Lint: {PASS/FAIL}
- PROGRESS.md: {consistent/inconsistent}

### Migration Concerns
- {Issue} or "None — no persistent state changes"

### Test Results
- Unit: {PASS}/{total}
- E2E: {PASS}/{total}
- Validation: {PASS/FAIL}

### Suggested Commit
```
{type}({scope}): {description} ({contract ID})
```

### Verdict
{One of:}
- PASS — ready to commit
- CHANGES_REQUESTED — {list specific issues to fix before commit}
```

## Rules

- **Never commit or push** without explicit instruction
- **Staged diff only** — do not expand the review to unstaged changes
- **Flag unrelated files** — if someone staged `package-lock.json` with contract code, catch it
- **Be specific** — report file:line numbers, not general categories
- **Contract linter** — run it; don't skip it
