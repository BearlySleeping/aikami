---
description: Implement a contract from contracts/ — read spec → build → validate → commit
argument-hint: "[contract name or leave empty to pick next pending]"
---

# Contract Implementation Workflow

User input: $ARGUMENTS

## Phase 1: Load Contract

1. Read `docs/contracts/INDEX.md` — get current priority ranking
2. Read `docs/contracts/PROGRESS.md` — check in-progress/completed
3. If $ARGUMENTS specified, load that contract. Otherwise, pick next `not_started`.
4. Read the contract fully. Understand: data model, acceptance criteria, test hooks, implementation notes.
5. Run `moon_detect_affected` to see current project state.

## Phase 2: Implement

0. Consult `.pi/skills` for routing patterns, naming conventions, and UI conventions (Svelte 5 runes, Tailwind) before writing any code.
1. For each acceptance criterion:
    - Create/modify files per the Implementation Notes
    - Follow `aikami-conventions` (snake*case files, ViewModel pattern, Svelte 5 runes, arrow functions, early returns, options objects, private `*` prefix)
    - Use `moon_run_task` for per-project fix/typecheck — NOT raw bun commands
    - Commit in logical groups (one per AC or file group)

## Phase 3: Verify

1. Run `validate({ test: true })` — fix+typecheck+build+test on all affected
2. If errors: fix and re-run until clean
3. Manually verify each AC

## Phase 4: Log & Archive

1. Update `docs/contracts/PROGRESS.md`:
    - Flip the contract's status to `✅ completed` in the Status Summary table ONLY.
    - **NEVER** append granular execution logs (findings, files created/modified, deviations, limitations) to PROGRESS.md. PROGRESS.md is strictly a dashboard table.
2. Append the granular Execution Report (Summary, AC Status, Files created/modified, Deviations, Test Results) to the **BOTTOM of the individual contract markdown file** (e.g., `C-105-feature.md`). Keep each contract self-contained.
3. Add `<!-- completed: YYYY-MM-DD -->` as the first line of the contract file.
4. Update `docs/contracts/INDEX.md` status: `not_started` → `completed`
5. Present a diff summary + a suggested Conventional Commit message (e.g., `feat(client): add combat system`)
6. Ask: "Commit? Commit+push? Continue to next contract?"

## Hard Rules

- Never push without explicit instruction
- Never run two contracts simultaneously
- Always use `validate()` not raw fix/typecheck/test commands
- Always use `moon_run_task` for project-specific operations
- Reference `aikami-conventions` skill for patterns (covers both general TS + framework-specific)
- Keep PROGRESS.md status table updated after each phase (status flips only, no execution logs)
- Execution reports go in the individual contract file
- **NEVER** execute long-lived server commands (e.g., `vite dev`, `vite preview`, `bun run dev`, `moon run dev`) in the main execution thread. These will freeze the agent loop. If you absolutely must start a server, use the `firebase_emulator` or `tmux_session` tool to run it in the background.
