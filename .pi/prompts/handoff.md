# Session Handoff

When the user asks for a handoff summary (or types `/handoff`), generate a
self-contained prompt that can be pasted into a NEW session to continue work.
The goal: restart with $0 spending while preserving all essential context.

## Output Format

```markdown
## Continuing: {one-line task description}

### What's been done
- [x] {completed item 1}
- [x] {completed item 2}

### In progress
- [ ] {current work item}
- [ ] {next item}

### Files modified
- `path/to/file.ts` — {what was changed}
- `path/to/other.ts` — {what was changed}

### Key decisions
- {decision 1 + rationale}
- {decision 2 + rationale}

### Current blockers / open questions
- {blocker or "none"}

### Architecture context
- {any project structure, conventions, or patterns needed to continue}

### Diagnostic state (if debugging)
- {what was tried, what was learned, what logs showed}

### Next action
{paste-ready instruction for the new session to continue. Include specific files to read, commands to run, or tasks to complete.}
```

## Rules
1. Be self-contained — the new session knows nothing about this one
2. Include file paths so the new session can `read` them
3. Mention which skills to load (via skill descriptions)
4. If in the middle of debugging: include what was tried, what failed, what was learned
5. Keep under 500 words — the new session has its own context window to fill
6. End with a single "Next action" instruction that starts the new session immediately

## Example

User: "handoff"
AI:
```
## Continuing: Harden the pre-commit guard integration

### What's been done
- [x] Added `run_guards.ts` — parallel structural guards (~1.5s vs ~34s via Moon)
- [x] Wired it into `pre_commit.ts` after `:fix`, before `:typecheck`
- [x] Wired it into pi's `validate` tool

### In progress
- [ ] Extract the combat encounter cases out of `ecs_worker.ts` (size waiver)

### Files modified
- `scripts/src/lib/ops/run_guards.ts` — new guard runner
- `scripts/src/lib/ops/pre_commit.ts` — guard step
- `.pi/extensions/moon_integration.ts` — validate runs guards

### Key decisions
- Run guards directly, not via `moon run scripts:guard` (Moon hashes the whole repo)
- Never raise a baseline/waiver to clear a guard — fix the code

### Current blockers
None

### Next action
Run `bun run scripts/src/lib/ops/run_guards.ts`, then extract the combat cases
from `packages/frontend/engine/src/worker/ecs_worker.ts` into a combat module.
```
