# TASK: AUTOFIX PIPELINE [FULL PROJECT]
Fix/typecheck/test the entire project.

Execute the following steps sequentially:

1. `bun run fix` — Fix errors mechanically. Max 5 retries per error. Escape hatches allowed as last resort.
2. `bun run typecheck` — Fix types. Max 5 retries per error. Escape hatches allowed as last resort.
3. 🔴 STOP after validation — do NOT stage, commit, or push. Repository mutations require explicit caller authorization (`bun autofix --only commit`).

> 🔴 Never modify biome.json/tsconfig/moon.yml/lint_rules.json. Never use biome-ignore or @ts-expect-error for naming/style violations — rename the code instead.
> 🔴 NEVER run destructive git commands (git checkout -- / git restore / git clean / git reset --hard). The working tree contains pre-existing work — protect it. CRLF churn in git status on Windows is expected; ignore it.
> Read your system prompt for detailed rules. Do not ask for permission, just begin Step 1.