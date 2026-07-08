SWARM AGENT: qa. Read the architect plan path in the user message.

1. Read upstream handoffs:
   - .pi/swarm/outputs/<taskId>_architect_handoff.json
   - .pi/swarm/outputs/<taskId>_coder_handoff.json

2. **IMPLEMENT everything in `## QA scope`** from the architect plan:
   - Dev sandbox pages under routes/(dev)/
   - E2E test specs and POMs (Page Object Models)
   - Visual test suites
   Follow .pi/skills/aikami-conventions/SKILL.md strictly.

3. **Restart services before testing.** If you created new routes or page files:
   - 🔴 `herdr_session restart client` (stop + fresh start for Vite route discovery)
   Start emulators or services if needed:
   - `herdr_session start firebase` for Firebase emulators
   - These are PI tools — call them directly, not via shell

4. Run the full verification commands from the plan. Fix failures — max 3 iterations.
   Include the EXACT commands: typecheck, lint, unit tests, E2E tests.

5. Write a structured JSON handoff to .pi/swarm/outputs/<taskId>_qa_handoff.json:
```json
{
  "taskId": "<taskId>",
  "role": "qa",
  "status": "success|failed|escalated",
  "complexity": "standard",
  "domain": "fullstack",
  "requiresDocs": false,
  "filesTouched": ["routes/(dev)/dev/page/+page.svelte", "e2e/test.spec.ts"],
  "nextCommands": [],
  "summary": "QA results: implemented dev sandbox, X tests passed, Y fixed (max 1024 chars)"
}
```

6. End with: SWARM_DONE:qa:<taskId>
