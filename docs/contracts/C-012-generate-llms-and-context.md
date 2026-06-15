## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami `llms.txt` + `CONTEXT.md` generation pattern |
| **Target** | `/aikami/knowledge/llms.txt` + `knowledge/CONTEXT.md` |
| **Priority** | P2 — AI tooling QoL; not blocking development |
| **Dependencies** | C-002 (knowledge dir), C-007 (scripts project) |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

Generate `knowledge/llms.txt` (AI-first file index) and `knowledge/CONTEXT.md` (2-page AI briefing) for the aikami monorepo. These files serve as the entry point for all AI tools (pi, Manus, Claude, etc.) to understand the project structure, navigate files, and know what to build next.

## Design Reference

**Aikami `llms.txt`** structure:
- Generated file (run `bun run scripts/src/lib/generate_llms_txt.ts`)
- Lists every file in `knowledge/` grouped by category
- Quick Start section (top 5 files to read first)
- "How to Use" section for AI tools
- "Adding files" instructions for humans

**Aikami `CONTEXT.md`** structure:
- What We're Building (1 paragraph)
- Tech Stack (one-line)
- Current Phase
- Active Contracts (table with priority and status)
- Known Limitations
- Project Conventions (file naming, code patterns, contract format)
- How AI Tools Work Together
- Key Files (read these next)

## Acceptance Criteria

### AC-1: llms.txt Generated
**Given** the knowledge directory is populated (C-002)
**When** the generation script runs
**Then** `knowledge/llms.txt` is generated with all knowledge directory files indexed by category

**Test Hooks**:
- Unit: `test -f knowledge/llms.txt`
- Unit: Generated file contains "AI-first entry point"
- Unit: Generated file lists at minimum architecture/, contracts/, decisions/, guides/, intro/
- Unit: File has a "How to Use" section for AI tools

### AC-2: CONTEXT.md Written
**Given** the aikami project structure and contracts
**When** CONTEXT.md is written
**Then** it contains: What We're Building, Tech Stack, Current Phase, Active Contracts, Known Limitations, Project Conventions, Key Files

**Test Hooks**:
- Unit: `test -f knowledge/CONTEXT.md`
- Unit: Contains "What We're Building" section describing aikami
- Unit: Contains "Tech Stack" section listing Bun, SvelteKit 2, Firebase
- Unit: Contains "Active Contracts" table referencing existing contracts in knowledge/contracts/
- Unit: Is approximately 2 pages (~400-600 lines of markdown)

### AC-3: Generation Script Idempotent
**Given** the knowledge directory changes (files added/removed)
**When** the generation script runs again
**Then** `llms.txt` is regenerated with the updated file list

**Test Hooks**:
- Unit: Add a new file to knowledge/architecture/, run script, verify it appears in llms.txt
- Unit: Remove a file, run script, verify it's removed from llms.txt

### AC-4: CONTEXT.md References Active Contracts
**Given** multiple contracts exist in `knowledge/contracts/`
**When** CONTEXT.md is updated
**Then** the Active Contracts table lists each contract with priority, status, and a one-line description

**Test Hooks**:
- Unit: Table contains C-001 through C-012
- Unit: Each row has priority (P0/P1/P2) and status

### AC-5: Key Files Section
**Given** CONTEXT.md is written
**When** an AI tool reads it
**Then** the Key Files section points to the 5-8 most important files to read next

**Test Hooks**:
- Unit: Section lists at minimum: architecture, contracts INDEX, intro/vision, guides/dev-workflow

## Implementation Notes

1. **generate_llms_txt.ts**: Copy from aikami `scripts/src/lib/generate_llms_txt.ts`, adapt paths
2. **Run on post-merge hook**: Add `bun run knowledge:generate` to `.moon/hooks/post-merge` so llms.txt is always current
3. **CONTEXT.md is hand-written**: Unlike llms.txt which is auto-generated, CONTEXT.md is manually maintained (update when project scope, phase, or conventions change)
4. **Template for CONTEXT.md**: Use aikami's `CONTEXT.md` as a structural template, fill with aikami-specific content
5. **Active Contracts section**: List all C-0XX contracts with their current status — update as contracts are completed
6. **Known Limitations**: Document current aikami limitations (auth setup, Firebase config, test coverage gaps)

## Edge Cases & Gotchas

- **CONTEXT.md drift**: CONTEXT.md can fall out of date if not updated alongside code changes — add a reminder to the PR template or pre-commit hook
- **llms.txt vs CONTEXT.md scope**: llms.txt is the "map" (file index), CONTEXT.md is the "briefing" (project overview). Both should exist and be kept current
- **AI tool consumption**: Keep CONTEXT.md under ~600 lines — AI context windows are limited. Be concise
- **Generated file in git**: llms.txt should be committed to git (AI tools need it at clone time), but it's auto-generated — trust the generation script
