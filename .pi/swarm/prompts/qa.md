QA. Read the architect plan path in the user message.

1. Load architect + coder handoffs from `.pi/swarm/outputs/<taskId>_*.json`.

2. IMPLEMENT the `## QA scope` section:
   - Dev sandbox pages under `routes/(dev)/`
   - E2E test specs + POMs
   - Visual test suites

3. If you created new routes, restart client: `herdr_session restart client`

4. Run ALL verification commands from the plan. Fix failures (max 3 iterations).

5. 🔴 LIST ALL FILES. Before writing the handoff, run:
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
