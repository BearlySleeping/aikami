## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami knowledge setup — `knowledge/` |
| **Target** | `/knowledge/` — aikami monorepo root |
| **Priority** | P0 — Required before any other contract can reference knowledge docs |
| **Dependencies** | C-001 (clean root first) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Establish a `knowledge/` directory at the monorepo root, following the aikami knowledge structure. This becomes the single source of truth for architecture docs, feature contracts, decision records, guides, and intro docs. All AI tools (pi, and any future tools) read from this directory.

## Design Reference

**Aikami knowledge structure** (`/home/sonny/Development/Projects/passion/aikami/knowledge/`):

```
knowledge/
├── CONTEXT.md          # 2-page AI briefing
├── llms.txt            # Auto-generated file index (AI-first entry point)
├── README.md           # Human intro
├── index.md            # Welcome page
├── .gitignore          # Knowledge-specific ignores
├── architecture/       # System architecture and technical blueprints
├── contracts/          # Feature specifications (TEMPLATE.md + active contracts)
├── decisions/          # Architecture Decision Records
├── design/             # Design tokens, UI patterns
├── guides/             # How-to guides, setup instructions, workflows
├── intro/              # Project overview, vision, developer guidelines
├── lovable/            # Lovable.dev integration (aikami: may skip this)
├── scripts/            # Knowledge maintenance scripts (generate_llms_txt.ts)
├── tickets/            # Bug reports and feature request templates
```

## Acceptance Criteria

### AC-1: Directory Structure Created
**Given** the monorepo root has no `knowledge/` directory
**When** this contract is implemented
**Then** the full knowledge directory tree exists with all subdirectories

**Test Hooks**:
- Unit: `test -d knowledge/architecture && test -d knowledge/contracts && test -d knowledge/decisions && test -d knowledge/guides && test -d knowledge/intro`

### AC-2: TEMPLATE.md Copied
**Given** aikami has `knowledge/contracts/TEMPLATE.md`
**When** this contract is implemented
**Then** aikami has `knowledge/contracts/TEMPLATE.md` with the same structure (adapted for aikami naming)

**Test Hooks**:
- Unit: `test -f knowledge/contracts/TEMPLATE.md`
- Unit: File contains required sections: Metadata, Overview, Design Reference, Data Model, Acceptance Criteria, Implementation Notes

### AC-3: CONTEXT.md Created
**Given** aikami has no CONTEXT.md
**When** this contract is implemented
**Then** `knowledge/CONTEXT.md` exists as a 2-page AI briefing covering: what we're building, tech stack, active contracts, known limitations, project conventions, and key files

**Test Hooks**:
- Unit: `test -f knowledge/CONTEXT.md`
- Unit: File contains "What We're Building", "Tech Stack", "Active Contracts", "Known Limitations", "Project Conventions"

### AC-4: Directory READMEs
**Given** each knowledge subdirectory exists
**When** the structure is established
**Then** each subdirectory contains a brief README.md explaining its purpose

**Test Hooks**:
- Unit: Each subdir has a README.md with a one-line description

### AC-5: Knowledge .gitignore
**Given** the knowledge directory has its own `.gitignore`
**When** the directory is set up
**Then** it ignores generated files (llms.txt can be committed since it's auto-generated but useful for AI tools)

**Test Hooks**:
- Unit: `test -f knowledge/.gitignore`

## Implementation Notes

1. **Copy from aikami**: Copy `knowledge/contracts/TEMPLATE.md`, `knowledge/.gitignore` directly from aikami
2. **Adapt CONTEXT.md**: Write fresh for aikami — reference apps/frontend/client, packages/shared/*, Firebase, SvelteKit 2
3. **Skip lovable/**: Aikami doesn't use Lovable — skip this subdirectory unless needed later
4. **scripts/ subdir**: Copy `generate_llms_txt.ts` from aikami knowledge/scripts, adapt for aikami paths
5. **Do NOT copy aikami-specific docs**: Only copy structural templates and meta-docs, not feature-specific content

## Edge Cases & Gotchas

- **Existing docs/ directory**: Aikami has a root-level `docs/` directory — consolidate its useful content into `knowledge/guides/` and remove `docs/`
- **Existing examples/ directory**: Review and either consolidate into `knowledge/guides/` or keep as-is if they're runnable code examples
- **Firebase debug logs**: `firebase-debug.log` and `firestore-debug.log` at root level should be gitignored, not moved to knowledge
