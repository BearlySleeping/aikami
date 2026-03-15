---
name: rtk
description: Token-Optimized Commands - RTK filter wrappers for 60-90% token savings on common development operations.
version: 1.0.0
author: Aikami Team
tags: ["rtk", "tokens", "cli", "optimization"]
---

# RTK - Token-Optimized Commands

Always prefix commands with `rtk`. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:

```bash
# Wrong
git add . && git commit -m "msg" && git push

# Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

---

## Build & Compile (80-90% savings)

| Command | Purpose |
|---------|---------|
| `rtk cargo build` | Cargo build output |
| `rtk cargo check` | Cargo check output |
| `rtk cargo clippy` | Clippy warnings grouped by file (80%) |
| `rtk tsc` | TypeScript errors grouped by file/code (83%) |
| `rtk lint` | ESLint/Biome violations grouped (84%) |
| `rtk prettier --check` | Files needing format only (70%) |
| `rtk next build` | Next.js build with route metrics (87%) |

---

## Test (90-99% savings)

| Command | Purpose |
|---------|---------|
| `rtk cargo test` | Cargo test failures only (90%) |
| `rtk vitest run` | Vitest failures only (99.5%) |
| `rtk playwright test` | Playwright failures only (94%) |
| `rtk test <cmd>` | Generic test wrapper - failures only |

---

## Git (59-80% savings)

| Command | Purpose |
|---------|---------|
| `rtk git status` | Compact status |
| `rtk git log` | Compact log (works with all git flags) |
| `rtk git diff` | Compact diff (80%) |
| `rtk git show` | Compact show (80%) |
| `rtk git add` | Ultra-compact confirmations (59%) |
| `rtk git commit` | Ultra-compact confirmations (59%) |
| `rtk git push` | Ultra-compact confirmations |
| `rtk git pull` | Ultra-compact confirmations |
| `rtk git branch` | Compact branch list |
| `rtk git fetch` | Compact fetch |
| `rtk git stash` | Compact stash |
| `rtk git worktree` | Compact worktree |

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

---

## GitHub (26-87% savings)

| Command | Purpose |
|---------|---------|
| `rtk gh pr view <num>` | Compact PR view (87%) |
| `rtk gh pr checks` | Compact PR checks (79%) |
| `rtk gh run list` | Compact workflow runs (82%) |
| `rtk gh issue list` | Compact issue list (80%) |
| `rtk gh api` | Compact API responses (26%) |

---

## Bun & Project Tooling

Since RTK does not have a native `bun` subcommand, use the universal wrappers:

| Command | Purpose |
|---------|---------|
| `rtk summary bun install` | Heuristic summary of install output |
| `rtk err bun run <script>` | Show only errors/warnings |
| `rtk err bunx <cmd>` | Show only errors for CLI commands |
| `rtk err bun moon <args>` | Filter Moon task runner output to errors only |
| `rtk test bun moon run pwa:test` | Generic test wrapper - failures only |
| `rtk summary bun run deps:check` | Summary of Syncpack dependency check |

---

## Files & Search (60-75% savings)

| Command | Purpose |
|---------|---------|
| `rtk ls <path>` | Tree format, compact (65%) |
| `rtk read <file>` | Code reading with filtering (60%) |
| `rtk grep <pattern>` | Search grouped by file (75%) |
| `rtk find <pattern>` | Find grouped by directory (70%) |

---

## Analysis & Debug (70-90% savings)

| Command | Purpose |
|---------|---------|
| `rtk err <cmd>` | Filter errors only from any command |
| `rtk log <file>` | Deduplicated logs with counts |
| `rtk json <file>` | JSON structure without values |
| `rtk deps` | Dependency overview |
| `rtk env` | Environment variables compact |
| `rtk summary <cmd>` | Smart summary of command output |
| `rtk diff` | Ultra-compact diffs |

---

## Infrastructure (85% savings)

| Command | Purpose |
|---------|---------|
| `rtk docker ps` | Compact container list |
| `rtk docker images` | Compact image list |
| `rtk docker logs <c>` | Deduplicated logs |
| `rtk kubectl get` | Compact resource list |
| `rtk kubectl logs` | Deduplicated pod logs |

---

## Network (65-70% savings)

| Command | Purpose |
|---------|---------|
| `rtk curl <url>` | Compact HTTP responses (70%) |
| `rtk wget <url>` | Compact download output (65%) |

---

## Meta Commands

| Command | Purpose |
|---------|---------|
| `rtk gain` | View token savings statistics |
| `rtk gain --history` | View command history with savings |
| `rtk discover` | Analyze sessions for missed RTK usage |
| `rtk proxy <cmd>` | Run command without filtering (debugging) |
| `rtk init` | Add RTK instructions to CLAUDE.md |
| `rtk init --global` | Add RTK to ~/.claude/CLAUDE.md |

---

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | summary bun, err bun | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
