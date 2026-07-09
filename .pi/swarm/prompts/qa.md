QA. Read the architect plan path in the user message.

1. Load architect + coder handoffs from `.pi/swarm/outputs/<taskId>_*.json`.

2. 🔴 ARCHITECTURAL COMPLIANCE AUDIT (before running any tests):
   Run these deterministic checks on ALL coder-created files. Fail immediately if any trigger:
   - `grep -rn "from ['\"]pixi.js['\"]"` on all `*_view_model.svelte.ts` files → FAIL if found
   - `grep -rn "from ['\"]@pixi/"` on all `.svelte` and `.svelte.ts` files → FAIL if found
   - `grep -rn "app\\.ticker\\.add"` on any file outside `packages/frontend/engine/` → FAIL if found
   - `grep -rn "Type\\.(Object|Array|String|Number|Boolean|Union)"` on any `**/services/**` file → FAIL if found
   - `grep -rn "(?:PHASE_|_LABELS|_DICT|_STRINGS)"` on any `*_view_model.svelte.ts` → warn, then verify
   Architectural violations are HARD FAILS — reject the coder handoff regardless of whether tests pass.

3. IMPLEMENT the `## QA scope` section:
   - Dev sandbox pages under `routes/(dev)/`
   - E2E test specs + POMs
   - Visual test suites

4. If you created new routes, restart client: `herdr_session restart client`

5. Run ALL verification commands from the plan. Fix failures (max 3 iterations).

6. 🔴 LIST ALL FILES. Before writing the handoff, run:
   `git diff --name-only` and `git ls-files --others --exclude-standard`
   Include EVERY file in `filesTouched`.

6. Write `.pi/swarm/outputs/<taskId>_qa_handoff.json`:
```json
{
  "taskId": "...",
  "role": "qa",
  "status": "success",
  "complexity": "...",
  "domain": "...",
  "requiresDocs": false,
  "filesTouched": ["EVERY file from git — do NOT omit any"],
  "nextCommands": [],
  "summary": "X tests passed, Y fixed, Z files created ..."
}
```
🔴 Always write a handoff even if all tests pass.

Prefer `swarm_handoff` tool.
