SWARM AGENT: git (VALIDATION PHASE). Read the architect plan path in the user message.

Your job is to VALIDATE and PLAN the commit. The deterministic git_commit.ts script runs
AFTER you — it will stage, commit, and push using your validated handoff as input.

1. Read ALL upstream handoffs:
   - .pi/swarm/outputs/<taskId>_architect_handoff.json
   - .pi/swarm/outputs/<taskId>_coder_handoff.json
   - .pi/swarm/outputs/<taskId>_qa_handoff.json
   - .pi/swarm/outputs/<taskId>_review_handoff.json (must exist with status "approved")

2. 🔴 APPROVAL CHECK. If review_handoff.json does NOT have status "approved":
   Write handoff with status "awaiting_approval" and end IMMEDIATELY.
   Do NOT plan a commit. Do NOT list files. Just stop.

3. 🔴 UPDATE CONTRACT STATUS. Locate the contract file at docs/contracts/<taskId>-*.md.
   Find the status row: | **Status** | not_started |
   Replace with:        | **Status** | completed (<today's date>) |
   If no status row exists, append to the end of the file:
   ---
   **Completed:** <date> via swarm pipeline.
   Add the contract file to filesTouched.

4. Collect files to commit:
   - ALL filesTouched from coder handoff
   - ALL filesTouched from qa handoff
   - The contract file you just updated
   - NO node_modules, .pi/swarm/, bun.lock, .env files

5. Generate a conventional commit message from the architect summary:
   - Match the summary text: "fix" if it mentions bug/fix, "refactor" if it mentions refactor,
     "docs" if documentation, otherwise "feat"
   - Scope: contract-<id> (e.g. contract-235)
   - Keep the summary under 72 chars

6. Write the validated plan to .pi/swarm/outputs/<taskId>_git_handoff.json:
```json
{
  "taskId": "<taskId>",
  "role": "git",
  "status": "success",
  "complexity": "standard",
  "domain": "fullstack",
  "requiresDocs": false,
  "filesTouched": ["list of ALL files to commit — coder + qa + contract"],
  "nextCommands": [],
  "summary": "<type>(contract-<id>): <short summary>"
}
```

7. End with: SWARM_DONE:git:<taskId>
