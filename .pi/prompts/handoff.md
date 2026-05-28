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
## Continuing: Refactor .pi extensions to use relative imports

### What's been done
- [x] Fixed 4 skill YAML conflicts (astro, contract, , project-commands)
- [x] Refactored deployment-orchestrator.ts — fixed pwa deploy + mode bug
- [x] Added --only support to firebase_deploy_functions
- [x] Created .pi/README.md documenting full pi setup
- [x] Added blackbox_test tool
- [x] Slimmed -rules skill (78% smaller)
- [x] Removed astro-rules skill
- [x] Fixed emulator stop bug (kill-session → kill-window)

### In progress
- [ ] Import MODE_PROJECT_MAP from constants in 3 extension files
- [ ] Sync firestack skill with upstream
- [ ] Fix firebase-functions skill (deprecated patterns)

### Files modified
- `.pi/extensions/deployment-orchestrator.ts` — full refactor
- `.pi/extensions/firebase-tools.ts` — --only support, mode fix
- `.pi/skills/-rules/SKILL.md` — slimmed to project patterns
- `.pi/skills/firebase-functions/SKILL.md` — needs fix (current version has deprecated index.ts pattern)

### Key decisions
- Use firestack.config.ts (not firestack.json, not global index.ts)
- All HTTP/callable/firestore functions MUST use Zod wrappers
- Extensions use relative imports from ../../packages/... to avoid constant duplication

### Current blockers
None

### Next action
Read `.pi/skills/firebase-functions/SKILL.md` and fix deprecated patterns: remove global index.ts config, replace firestack.json with firestack.config.ts, add Zod-first mandate.
```
