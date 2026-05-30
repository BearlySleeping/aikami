## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami `.pi/` setup |
| **Target** | `/aikami/.pi/` |
| **Priority** | P0 — Required for pi agent to work with project-specific tools and skills |
| **Dependencies** | C-001 (clean root), C-002 (knowledge dir for contract-implementer skill) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Establish the `.pi/` directory at the monorepo root with project-specific extensions, skills, agents, and prompts. Copy the foundational setup from aikami and adapt for aikami's stack (SvelteKit PWA, Firebase, Bun, moon). The `.pi/` directory extends the global `~/.pi/` setup with project-specific tooling.

## Design Reference

**Aikami `.pi/` structure**:

```
.pi/
├── README.md              # Pi AI Agent Setup docs
├── settings.json          # Pi settings (steering mode, compaction, paths)
├── mcp.json               # MCP server config (context-mode)
├── .gitignore             # Ignore deps/caches
├── package.json           # Dependencies for extensions
├── bun.lock               # Lock file
├── tsconfig.json          # TS config for extensions
├── extensions/            # Custom pi extensions (tools + hooks)
│   ├── moon-integration.ts
│   ├── firebase-tools.ts
│   ├── log-viewer.ts
│   └── ... (aikami-specific)
├── skills/                # Project-specific skills
│   ├── firestack/SKILL.md
│   ├── project-commands/SKILL.md
│   ├── svelte-page/SKILL.md
│   ├── contract-implementer/SKILL.md
│   ├── knowledge-clerk/SKILL.md
│   └── aikami-conventions/SKILL.md
├── agents/                # Custom agent definitions
│   └── supervisor.md
├── prompts/               # Prompt templates
│   ├── contract.md
│   ├── dev.md
│   ├── pre-commit.md
│   └── handoff.md
└── themes/                # Optional: project-specific themes
```

## Acceptance Criteria

### AC-1: .pi Directory Structure Created
**Given** aikami has no `.pi/` directory
**When** this contract is implemented
**Then** the `.pi/` directory exists with README.md, settings.json, mcp.json, .gitignore, package.json, tsconfig.json

**Test Hooks**:
- Unit: `test -d .pi && test -f .pi/settings.json && test -f .pi/mcp.json && test -f .pi/README.md`

### AC-2: settings.json Configured
**Given** the `.pi/settings.json` file
**When** pi loads the project
**Then** it discovers extensions at `./.pi/extensions`, skills at `./.pi/skills`, prompts at `./.pi/prompts`

**Test Hooks**:
- Unit: JSON parse `.pi/settings.json` — must contain `extensions`, `skills`, `prompts` paths pointing to `.pi/` subdirs
- Unit: `steeringMode` and `followUpMode` set to `"all"`

### AC-3: mcp.json Configured
**Given** the `.pi/mcp.json` file
**When** pi starts
**Then** context-mode MCP server is configured

**Test Hooks**:
- Unit: JSON parse `.pi/mcp.json` — must contain `mcpServers.context-mode`

### AC-4: Extensions Directory Populated
**Given** aikami uses moon, Firebase, and has logging needs
**When** extensions are copied
**Then** at minimum `moon-integration.ts`, `firebase-tools.ts`, and `log-viewer.ts` are present

**Test Hooks**:
- Unit: `test -f .pi/extensions/moon-integration.ts`
- Unit: `test -f .pi/extensions/firebase-tools.ts`
- Unit: `test -f .pi/extensions/log-viewer.ts`

**Watch Points**:
- Skip aikami-specific extensions: `zeroclaw-orchestrator.ts`, `deployment-orchestrator.ts`, `genkit-manager.ts`, `tmux-orchestrator.ts`, `image-guard.ts` (aikami doesn't use Genkit, Zeroclaw, or tmux orchestration)
- Add only extensions that aikami actually needs

### AC-5: .pi .gitignore
**Given** the `.pi/` directory
**When** git status is checked
**Then** `node_modules/`, `bun.lock`, caches, and logs are ignored — but extensions, skills, agents, and prompts are tracked

## Implementation Notes

1. **Copy from aikami**: `settings.json`, `mcp.json`, `.gitignore`, `README.md`, `tsconfig.json` can be copied directly
2. **Adapt extensions path**: settings.json paths should reference `./.pi/extensions`, `./.pi/skills`, `./.pi/prompts`
3. **package.json**: Copy from aikami, keep only the dependencies needed by the extensions we're keeping
4. **Extensions to keep**: `moon-integration.ts`, `firebase-tools.ts`, `log-viewer.ts`
5. **Extensions to skip**: `deployment-orchestrator.ts`, `genkit-manager.ts`, `image-guard.ts`, `tmux-orchestrator.ts`, `zeroclaw-orchestrator.ts`
6. **Skills**: Handled by contract C-004
7. **Prompts**: Copy `contract.md`, `dev.md`, `pre-commit.md`, `handoff.md` — adapt for aikami naming conventions (e.g., `@aikami/` package scope vs `@aikami/`)

## Edge Cases & Gotchas

- **package.json dependencies**: Only include packages needed by the extensions we keep — don't pull in unused deps
- **Extensions must export default function**: Each extension file must export `default function (pi: ExtensionAPI)` — verify this when copying
- **Settings paths are relative**: The `settings.json` paths are relative to the workspace root, not `.pi/` itself
