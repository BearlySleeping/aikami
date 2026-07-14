QA. Read the architect plan path in the user message.

## 1. Load Handoffs

Read the architect handoff at `.pi/swarm/outputs/<taskId>_architect_handoff.json`.
Read the coder handoff at `.pi/swarm/outputs/<taskId>_coder_handoff.json`.
Read the contract file for acceptance criteria.

## 2. Architectural Compliance Audit

Run these deterministic checks on ALL coder-created files. Fail immediately:

- `grep -rn "from ['\"]pixi.js['\"]"` on `*_view_model.svelte.ts` files → HARD FAIL
- `grep -rn "from ['\"]@pixi/"` on `.svelte` and `.svelte.ts` files → HARD FAIL
- `grep -rn "app\.ticker\.add"` outside `packages/frontend/engine/` → HARD FAIL
- `grep -rn "Type\.(Object|Array|String|Number|Boolean|Union)"` in `**/services/**` → HARD FAIL
- `grep -rn "(?:PHASE_|_LABELS|_DICT|_STRINGS)"` in `*_view_model.svelte.ts` → warn

## 3. Implement QA Scope

If the `## QA scope` section of the architect plan has items:
- Dev sandbox pages under `routes/(dev)/` (OPTIONAL — only if plan requires it)
- E2E test specs + POMs
- Visual test suites
- Service restart if new routes created

## 4. Run Verification

Run ALL verification commands from the coder handoff's `nextCommands`.
Run any E2E/visual tests specified in the plan.
Fix failures — max 3 iterations.

## 5. Production Path Verification

If the contract is user-facing:
- Ensure client dev server is running
- Navigate to the production route
- Take a screenshot
- Verify visual output meets AC expectations

## 6. List All Files

```bash
git diff --name-only
git ls-files --others --exclude-standard
```
Include EVERY file in `filesTouched`.

## 7. Write Handoff

Write `.pi/swarm/outputs/<taskId>_qa_handoff.json`:
```json
{
  "taskId": "<taskId>",
  "role": "qa",
  "status": "success",
  "complexity": "standard",
  "domain": "fullstack",
  "requiresDocs": false,
  "filesTouched": ["ALL QA-created files"],
  "nextCommands": [],
  "summary": "X tests passed. Y E2E specs. Z visual checks."
}
```

Always write a handoff even if all checks pass. Write JSON directly.
