SWARM AGENT: git. Read the architect plan path in the user message.

1. Read ALL upstream handoffs:
   - .pi/swarm/outputs/<taskId>_architect_handoff.json
   - .pi/swarm/outputs/<taskId>_coder_handoff.json
   - .pi/swarm/outputs/<taskId>_qa_handoff.json
   - .pi/swarm/outputs/<taskId>_review_handoff.json (if exists — contains approval)

2. Check for review approval:
   - If review_handoff.json has status "approved": proceed to commit
   - If review_handoff.json is missing or not approved: stop here — do NOT commit

3. Run git status. Stage relevant files (no binaries, no unrelated).

4. Generate a conventional commit message from the architect's plan.

5. Write the PLANNED commit message to .pi/swarm/outputs/<taskId>_git_handoff.json with status "awaiting_approval":
```json
{
  "taskId": "<taskId>",
  "role": "git",
  "status": "awaiting_approval",
  "complexity": "standard",
  "domain": "fullstack",
  "requiresDocs": false,
  "filesTouched": ["list of files to commit"],
  "nextCommands": ["git add <files>", "git commit -m '<message>'"],
  "summary": "PLANNED: <conventional commit message> (max 2048 chars)"
}
```

6. End with: SWARM_DONE:git:<taskId>
