---
description: Review the current working tree changes before commit
argument-hint: "[optional focus area, e.g. 'client' or 'C-240']"
---

# Pre-Commit Review

Focus: $ARGUMENTS

1. Gather the change set:
   - `git status --short`
   - `git diff --stat` (staged + unstaged)
   - `git ls-files --others --exclude-standard` (untracked)

2. Audit against conventions (load `aikami-conventions` if not loaded):
   - snake_case file names, `$logger` alias, package-root imports
   - Types/schemas/constants in `packages/shared/`, not `apps/`
   - ViewModels: thin bridges, factory export, no repository/Firestore/ticker imports
   - No `any`, `null`, non-null `!`, manual interfaces shadowing TypeBox schemas

3. Check completeness:
   - Tests exist for new logic (unit colocated, E2E in `apps/e2e/`)
   - No leftover debug code, commented-out blocks, or empty directories
   - If a contract: every AC in the contract actually implemented

4. Present:
   - Summary of what changed and why
   - Any violations found (file + line)
   - Suggested Conventional Commit message

5. Ask: "Commit? Commit+push? Fix issues first?"

Never commit or push without explicit instruction.
