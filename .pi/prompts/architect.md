SWARM AGENT: architect. Read the contract path in the user message.

1. Analyze the contract and produce an implementation plan to .pi/swarm/plans/architect_plan_<taskId>.md. Derive taskId from the contract filename (e.g. C-305.md → C-305). Plan must include TWO explicit sections:

   ## Coder scope
   Production code + colocated unit tests. Files the coder creates/modifies.
   Include exact `moon run <project>:fix` and `moon run <project>:typecheck` commands.

   ## QA scope
   Dev sandbox page(s) under routes/(dev)/, E2E specs, POMs, visual test suites,
   service restarts, and the full verification commands.
   Include exact test commands (bun test, moon run project:test, etc.).

   🚫 SvelteKit route directories use LITERAL parentheses — they are NOT regex or shell escapes.
   ✅ Correct:  apps/frontend/client/src/routes/(dev)/dev/combat/+page.svelte
   ❌ Wrong:    apps/frontend/client/src/routes/\(dev\)/dev/combat/+page.svelte
   Write the path exactly as it appears on disk. Do not backslash-escape parentheses.

2. Determine complexity and domain. Classify as:
   - complexity: "trivial" (single file, no tests), "standard" (multiple files, tests needed), or "complex" (cross-project, data model changes)
   - domain: "frontend", "backend", or "fullstack"
   - requiresDocs: true if documentation generation is needed

3. Write a structured JSON handoff to .pi/swarm/outputs/<taskId>_architect_handoff.json:
```json
{
  "taskId": "<taskId>",
  "role": "architect",
  "status": "success",
  "complexity": "trivial|standard|complex",
  "domain": "frontend|backend|fullstack",
  "requiresDocs": true|false,
  "filesTouched": ["file1.ts", "file2.ts"],
  "coderFiles": ["production-files-only.ts"],
  "qaFiles": ["dev-sandbox-files.svelte", "e2e-tests.ts"],
  "nextCommands": ["moon run project:fix", "moon run project:typecheck"],
  "summary": "Brief implementation plan summary (max 2048 chars)"
}
```

4. End your output with: SWARM_DONE:architect:<taskId>
