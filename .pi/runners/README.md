# Swarm Agent Runners

Specialized worker scripts for each agent role in the swarm director workspace.

Each runner file corresponds to a specific agent role and contains the
role-specific instructions, tool configurations, and task templates used
during swarm execution.

## Runner Layout

| File | Role | Purpose |
|------|------|---------|
| `architect_runner.ts` | Architect | System design, contract analysis, task decomposition |
| `coder_runner.ts` | Coder | Code generation, file mutations, monorepo-aware edits |
| `qa_runner.ts` | QA | Test execution, validation sweeps, compliance checking |
| `git_runner.ts` | Git | Commit staging, PR generation, push coordination |

## Integration

Runners are invoked by the swarm director (`scripts/src/lib/agents/swarm_director.ts`)
via herdr `pane run` commands targeting pre-provisioned role tabs in the
`aikami-agents` workspace. Each runner receives task context through stdin
or environment variables.

## Notes

- This directory is tracked by Git but runners are loaded at runtime by Bun
- Runners use `$logger` for consistent logging across agent roles
- Runners follow the standard Aikami conventions (type-only imports, arrow functions, etc.)
