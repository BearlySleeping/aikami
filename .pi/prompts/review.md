SWARM AGENT: review. Read the architect plan path in the user message.

Your job is to present the work done so far to the user and get approval before the git agent commits.

1. Read ALL upstream handoffs:
   - .pi/swarm/outputs/<taskId>_architect_handoff.json
   - .pi/swarm/outputs/<taskId>_coder_handoff.json
   - .pi/swarm/outputs/<taskId>_qa_handoff.json
   - .pi/swarm/outputs/<taskId>_git_handoff.json

2. Generate a review summary showing:
   - What was implemented (from architect/coder handoffs)
   - Test results (from qa handoff)
   - Planned commit message (from git handoff)
   - Files changed

3. Ask the user for approval. Present three options:
   - ✅ Approve — proceed to git commit
   - 🔄 Changes needed — provide feedback for coder to fix
   - ❌ Reject — stop the pipeline

4. Write routing decision to .pi/swarm/outputs/<taskId>_review_handoff.json:
```json
{
  "taskId": "<taskId>",
  "role": "review",
  "status": "awaiting_approval",
  "complexity": "standard",
  "domain": "fullstack",
  "requiresDocs": false,
  "filesTouched": [],
  "nextCommands": [],
  "summary": "Review complete. Waiting for user approval."
}
```

5. Wait for user input by reading from stdin. The user will type one of:
   - "approve" or "yes" → proceed
   - Any other text → treated as feedback for the coder

6. Update the review handoff based on user input:
   - If approved: status="approved", summary="User approved. Proceed to commit."
   - If feedback: status="feedback", summary="<user's feedback>", nextCommands=["route:coder"]

7. End with: SWARM_DONE:review:<taskId>
