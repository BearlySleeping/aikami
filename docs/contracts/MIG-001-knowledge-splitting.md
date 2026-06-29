<!-- completed: 2026-06-29 -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami reference: `.context/` + `docs/` split pattern |
| **Target** | Migrate `knowledge/` to `.context/` (AI instructions) + `docs/` (human-readable) |
| **Priority** | P1 — structural refactoring, unblocks aikami alignment |
| **Dependencies** | None (standalone migration) |
| **Status** | **completed**  |
| **Contract version** | 1.0.0 |

## Overview

The current `knowledge/` directory mixes AI agent instructions with human-readable documentation. The Aikami pattern splits these into `.context/` (AI-only) and `docs/` (human-readable). This contract defines the exact file relocation mapping, updates all code references, and deletes the legacy `knowledge/` directory.

## Design Reference

**Aikami pattern**: `.context/` holds AI briefing files (`CONTEXT.md`, `llms.txt`, `index.md`). `docs/` holds all human-readable documentation (architecture, contracts, decisions, design, guides, intro, scripts, tickets).

Key structural elements:
- `.context/CONTEXT.md` — 2-page AI briefing (read first by any AI tool)
- `.context/llms.txt` — Complete AI-first file index
- `.context/index.md` — AI-first entry point
- `docs/architecture/` — System architecture diagrams and docs
- `docs/contracts/` — Feature contracts with BDD acceptance criteria
- `docs/decisions/` — Architecture Decision Records (ADRs)
- `docs/design/` — Design specs, tokens, visual references
- `docs/guides/` — How-to guides and workflows
- `docs/intro/` — Vision, setup, developer onboarding
- `docs/scripts/` — Knowledge maintenance scripts documentation
- `docs/tickets/` — Bug reports and feature requests
- `docs/README.md` — Human-facing docs hub (derived from knowledge/README.md)

## Changes Detail

### Path Mapping Table

| Old Path | New Path | Classification |
|----------|----------|----------------|
| `knowledge/CONTEXT.md` | `.context/CONTEXT.md` | AI briefing |
| `knowledge/llms.txt` | `.context/llms.txt` | AI-first index |
| `knowledge/index.md` | `.context/index.md` | AI entry point |
| `knowledge/README.md` | `docs/README.md` | Docs hub (rewritten) |
| `knowledge/architecture/` | `docs/architecture/` | Human-readable |
| `knowledge/contracts/` | `docs/contracts/` | Human-readable |
| `knowledge/decisions/` | `docs/decisions/` | Human-readable |
| `knowledge/design/` | `docs/design/` | Human-readable |
| `knowledge/guides/` | `docs/guides/` | Human-readable |
| `knowledge/intro/` | `docs/intro/` | Human-readable |
| `knowledge/scripts/` | `docs/scripts/` | Human-readable |
| `knowledge/tickets/` | `docs/tickets/` | Human-readable |

### Code References Updated

| File | Old Reference | New Reference |
|------|--------------|---------------|
| `README.md` | `knowledge/CONTEXT.md` | `docs/README.md`, `.context/CONTEXT.md` |
| `README.md` | `knowledge/llms.txt` | `.context/llms.txt` |
| `README.md` | `knowledge/architecture/architecture.md` | `docs/architecture/architecture.md` |
| `README.md` | `knowledge/guides/dev-workflow.md` | `docs/guides/dev-workflow.md` |
| `README.md` | `knowledge/contracts/INDEX.md` | `docs/contracts/INDEX.md` |
| `scripts/src/lib/generate_llms_txt.ts` | `knowledge/` dir constant | `.context/` dir constant |
| `scripts/src/lib/generate_context.ts` | `knowledge/` dir constant + inline refs | `.context/` dir constant + inline refs |
| `scripts/src/lib/setup.ts` | `knowledge/CONTEXT.md` etc. | `.context/CONTEXT.md` etc. |

## Acceptance Criteria

### AC-1: Directories Exist
**Given** the migration has executed
**When** listing the root directory
**Then** `.context/` directory exists with `CONTEXT.md`, `llms.txt`, and `index.md`
**And** `docs/` directory exists with all documentation subdirectories
**And** `knowledge/` directory no longer exists

**Test Hooks**:
- Unit: `test -d .context && test -d docs && test ! -d knowledge`
- CI: `ls -la .context/ docs/` shows expected structure

### AC-2: AI Files Relocated Without Data Loss
**Given** the migration has executed
**When** computing sha256 of each file that moved into `.context/`
**Then** each hash matches the original `knowledge/` equivalent

**Test Hooks**:
- Unit: `diff <(cd .context && find . -type f -exec sha256sum {} \; | sort) <(cd /tmp/orig-context && ...)`
- CI: Automated diff check via script

**Watch Points**:
- Verify `CONTEXT.md`, `llms.txt`, `index.md` are present in `.context/`

### AC-3: Doc Files Relocated Without Data Loss
**Given** the migration has executed
**When** comparing each `docs/` file against its `knowledge/` origin
**Then** all files match exactly (unmodified content)

**Test Hooks**:
- Unit: `diff -rq docs/architecture knowledge/architecture` (before deletion of knowledge/)
- CI: File count assertion — 48 files across categories

### AC-4: Code References Updated
**Given** the migration has executed
**When** searching for string `knowledge/` in all project source files (excluding `.git/`, `node_modules/`, `dist/`)
**Then** zero references remain

**Test Hooks**:
- Unit: `rg 'knowledge/' . --type-not binary | grep -v 'node_modules' | grep -v '.git/' | grep -v 'dist/' | grep -v 'docs/contracts/' | wc -l` must be 0
- CI: Automated grep assertion

**Watch Points**:
- Exclude `docs/contracts/` itself (this contract document references the old paths)
- Exclude `knowledge/` directory itself (it will be deleted)

### AC-5: Root README.md Updated
**Given** the migration has executed
**When** reading `README.md`
**Then** all documentation links point to `docs/` or `.context/` paths
**And** the `knowledge/` row in the project structure table is removed or replaced

**Test Hooks**:
- Unit: `rg 'knowledge/' README.md` returns no results
- CI: Manual review of README.md structure table

### AC-6: Script Generators Target Correct Directories
**Given** the migration has executed
**When** running `bun run scripts -- generate_llms`
**Then** the `.context/llms.txt` file is regenerated successfully
**When** running `bun run scripts -- generate_context`
**Then** the `.context/CONTEXT.md` file is regenerated successfully

**Test Hooks**:
- Integration: Run both scripts and verify output files exist in `.context/`
- CI: Generated files pass markdown validation

## Implementation Notes

1. **Files to create**: `docs/README.md` (rewritten from knowledge/README.md), `docs/contracts/MIG-001-knowledge-splitting.md`
2. **Files to modify**: `README.md`, `scripts/src/lib/generate_llms_txt.ts`, `scripts/src/lib/generate_context.ts`, `scripts/src/lib/setup.ts`
3. **Files to delete**: Entire `knowledge/` directory after migration
4. **Order of operations**:
   1. Create `.context/` directory
   2. Move `CONTEXT.md`, `llms.txt`, `index.md` → `.context/`
   3. Create `docs/` directory and subdirectories
   4. Move `architecture/`, `contracts/`, `decisions/`, `design/`, `guides/`, `intro/`, `scripts/`, `tickets/` → `docs/`
   5. Create `docs/README.md` (rewritten)
   6. Update `README.md` references
   7. Update `scripts/src/lib/generate_llms_txt.ts`
   8. Update `scripts/src/lib/generate_context.ts`
   9. Update `scripts/src/lib/setup.ts`
   10. Verify no remaining `knowledge/` references in source
   11. Delete `knowledge/` directory
5. **Verification**: Run `bun run typecheck` and `bun run fix` after all changes, then run `bun run scripts -- generate_llms && bun run scripts -- generate_context`

## Edge Cases & Gotchas

- **`docs/` already exists**: If `docs/` directory exists in the monorepo (it's an Astro app), verify it's `apps/frontend/docs/` not root `docs/`. Root `docs/` is safe to create alongside it.
- **Contract references in this file**: This contract (MIG-001) documents the old paths for traceability. The grep verification (AC-4) must exclude `docs/contracts/MIG-001-knowledge-splitting.md`.
- **`knowledge/scripts/README.md` vs `scripts/` project**: The `knowledge/scripts/` folder contains only a README documenting the knowledge maintenance scripts. The actual scripts live in `scripts/` at the repo root. These are distinct — `knowledge/scripts/README.md` moves to `docs/scripts/README.md`.
- **`.context/` hidden directory**: Tools that ignore dot-directories by default (e.g., `ls` without `-a`) may appear to miss `.context/`. The root README.md will explicitly mention it.
- **`knowledge/CONTEXT.md` is auto-generated**: After migration, re-running `generate_context` must produce identical output. Verify that the generator script produces valid output in the new location.
