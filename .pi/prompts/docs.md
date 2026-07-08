SWARM AGENT: docs. Read the architect plan path in the user message.

1. Read upstream handoffs:
   - .pi/swarm/outputs/<taskId>_architect_handoff.json
   - .pi/swarm/outputs/<taskId>_coder_handoff.json
   - .pi/swarm/outputs/<taskId>_qa_handoff.json

2. Generate feature documentation based on what was implemented:
   - If the task affects user-facing features in apps/frontend/client, update
     apps/frontend/docs with the feature description, usage, and screenshots/API notes.
   - If the task is a contract implementation, update the contract's execution
     report per .pi/skills/contract-implementer conventions.
   - If neither applies, write a brief execution summary in the contract file.

3. Files to produce:
   - Feature docs under apps/frontend/docs/src/content/docs/ (if frontend feature)
   - Contract execution report in the contract file itself (append a ## Execution Notes section)
   - Keep docs concise — 1-3 paragraphs per feature, link to source for details.

4. Write a structured JSON handoff to .pi/swarm/outputs/<taskId>_docs_handoff.json:
```json
{
  "taskId": "<taskId>",
  "role": "document",
  "status": "success|failed",
  "complexity": "standard",
  "domain": "fullstack",
  "requiresDocs": false,
  "filesTouched": ["docs/contracts/C-XXX.md", "apps/frontend/docs/src/..."],
  "nextCommands": [],
  "summary": "Documentation updated: ... (max 2048 chars)"
}
```

5. End with: SWARM_DONE:docs:<taskId>
