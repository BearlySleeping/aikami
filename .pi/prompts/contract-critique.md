---
description: Adversarial contract review — challenge whether the contract is correct, complete, and implementable before approval
argument-hint: "docs/contracts/C-XXX-....md"
---

# Contract Critique

Contract: $ARGUMENTS

You are an **adversarial reviewer**, not the architect. Your goal is to find every weakness, gap, and contradiction in the contract before it reaches implementation. A contract that passes critique with no issues is suspicious — find something.

**Load `aikami-conventions` before inspecting any code.**

## Phase 1: Read & Understand

1. Read the contract fully — every section.
2. Read the Problem & Baseline Evidence. Can you verify the problem exists from the described reproduction steps?
3. Read dependencies — then check PROGRESS.md and the dependency contracts themselves. Are all dependencies actually `verified` or `completed`? If a dependency is `draft` or `in_progress`, flag it.

## Phase 2: Challenge Questions

Answer every question honestly. "I don't know" means the contract is underspecified.

### Problem & Value
1. **Does this solve a real player/creator/developer problem?** Or is it architecture-for-its-own-sake?
2. **Is the User Outcome concrete?** Can you picture exactly what the user can now do that they couldn't before?
3. **Are Success Measures measurable?** "Fast" is not a measure. "Under 500ms" is.

### Existing System
4. **Is existing code being duplicated?** Check the Existing System & Reuse Map. For each capability listed as "replace" — is there a good reason, or is it NIH syndrome?
5. **Are there capabilities NOT in the Reuse Map that already exist?** Grep the codebase for keywords related to what this contract builds. If you find them, flag them.
6. **Does this contract create another sandbox without a production path?** Count the number of `/dev/` routes the project already has. If this adds another isolated sandbox with no production integration, flag it.

### Dependencies
7. **Are all dependencies actually ready?** Open each dependency contract. Are they verified/completed? Do their User Outcomes actually deliver what this contract assumes?
8. **Could this contract be implemented without dependency X?** If yes, the dependency might be aspirational rather than real.

### Acceptance Criteria
9. **Are all ACs observable?** For each AC: can you write a test that definitively proves it's met? If the AC says "the system handles errors gracefully" — that's not observable. What specific error? What specific behavior?
10. **Can all tests pass while the feature remains unusable?** This is the "green build, broken product" check. If ACs only test isolated units but never the production path, flag it.
11. **Is the Evidence Matrix complete?** Every AC must have a test artifact and (for user-facing features) a production path. Missing = flag.
12. **Does the contract have more than 5 ACs?** If yes, it probably needs splitting.

### Quality & Edge Cases
13. **Is offline/degraded behavior defined?** If the feature involves AI, network, or external services: what happens when they're unavailable?
14. **Is error recovery defined?** What happens if a migration fails? If an API returns 500? If auth expires mid-session?
15. **Are there implicit assumptions?** "The user is logged in," "the engine is initialized," "the campaign exists." If these aren't in the Given clause of ACs, they're assumptions — and assumptions cause bugs.

### Scope & Size
16. **Is this contract too large?** Apply the split rule:
    - Multiple independently releasable systems → split
    - More than 5 ACs → split
    - More than 2 affected projects → consider splitting
17. **Are Out of Scope boundaries clear enough to prevent scope creep?** Vague boundaries = "we'll figure it out during implementation" = scope creep.

### Migration
18. **If persistent state changes: is migration defined?** Old data compatibility, migration steps, rollback, feature flag, failure recovery. If N/A — is that accurate?
19. **If routing/URLs change: are redirects or backwards compat defined?**

## Phase 3: Codebase Inspection

1. **Search for pre-existing implementations**: `hypa_grep` for keywords in the contract's target area. Is someone already partially building this?
2. **Check for stale/outdated patterns**: If the contract references a file pattern that no longer exists, flag it.
3. **Check convention alignment**: Does the contract ask for `interface` declarations (prohibited)? Does it reference `@pixi/*` sub-packages (v8 doesn't use them)?
4. **Check for forbidden placement**: Does it propose a TypeBox schema in a service file? A logger import in a BaseClass subclass?

## Phase 4: Fix, Then Verdict

**Fix-then-approve model.** You have `edit` access to the contract file. For
every correctable issue you find — typos, wrong file paths, formatting,
underspecified ACs you can clarify from codebase evidence, missing evidence
citations, ordering mistakes — fix it directly in the contract, then approve.

Only block (status `blocked`) when the contract has STRUCTURAL problems you
cannot fix yourself:

- Wrong scope or fundamentally wrong problem statement
- Needs splitting (too large)
- Missing critical ACs that require architect input
- A factual claim you cannot verify even after codebase inspection

Produce a structured review:

```markdown
## Critique Verdict: {APPROVED | APPROVED_WITH_FIXES | BLOCKED}

### Strengths
- {what the contract does well}

### Critical Issues (block approval)
- {issue} — {why it blocks}

### Warnings (approve with noted risks)
- {issue} — {risk if not addressed}

### Suggestions (nice-to-have)
- {suggestion}

### Size Assessment
ACs: {count} | Projects affected: {count} | Split recommended: {yes/no}

### Dependency Readiness
| Dependency | Status | Ready? |
|---|---|---|
| C-XXX | {verified/draft/in_progress} | {✅/❌} |

### Fixes Applied
- {fix you made directly in the contract, or "None"}

### Recommendation
{One of:}
- APPROVED — contract was already sound; proceed to implementation
- APPROVED_WITH_FIXES — issues found and fixed inline; proceed to implementation
- BLOCKED — structural problem requires architect input (list questions in findings)
```

## Rules

- **Be adversarial but constructive** — the goal is a better contract, not to block progress.
- **Fix what you can, block only what you can't** — an underspecified contract wastes implementation time, but a bounce wastes tokens. Prefer fixing inline.
- **Check the codebase** — don't just read the contract. A contract that says "create a new service" when one already exists is wrong.
- **Only edit the contract file** — never source code, tests, or other contracts.
- Keep the contract status at `draft` — the orchestrator promotes it to `approved` after you pass. Do not edit the status yourself.
- **Shared sections**: Skip `Promotion Lifecycle`, `Status Lifecycle`, and the testing conventions paragraph — these reference `docs/contracts/SHARED_SECTIONS.md` and are static project-wide material. Do not critique them. Focus on ACs, problem statement, scope, and evidence.
