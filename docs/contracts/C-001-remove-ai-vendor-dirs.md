## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami knowledge setup — `knowledge/contracts/TEMPLATE.md` |
| **Target** | `/` — aikami monorepo root |
| **Priority** | P0 — Blocks all other refactoring; must clean stale configs first |
| **Dependencies** | None |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

Remove all stale AI-tool vendor directories and configs from the aikami monorepo. These were added by various AI tools (Claude, Gemini, Cursor, Qwen, OpenSpec, etc.) and are no longer relevant. We are consolidating on pi as the single AI agent, with all project-specific configuration living under `.pi/`.

## Design Reference

**Aikami reference**: Clean root — only `.pi/` for AI agent config, `.moon/` for task orchestration, no vendor-specific AI dirs.

## Directories and Files to Remove

```bash
# AI vendor directories
rm -rf .agent
rm -rf .agents
rm -rf .ai
rm -rf .claude
rm -rf .cursor
rm -rf .gemini
rm -rf .github        # Note: may need to preserve CI workflows — review first
rm -rf .github_old
rm -rf .opencode
rm -rf .qwen
rm -rf .zed
rm -rf openspec

# Stale root-level AI tool files
rm -f AGENTS.md       # Replaced by knowledge/CONTEXT.md
rm -f CLAUDE.md
rm -f opencode.json
rm -f skills-lock.json
rm -f firestack.skill
rm -f session-ses_34bd.md
rm -f .rules           # Replaced by .pi/skills

# Stale root-level dev files (replaced by knowledge/)
rm -f DEVELOPMENT.md
rm -f CONTRIBUTING.md
rm -f TODO.md
```

**⚠️ Important**: Review `.github/` before removing — it may contain CI workflows worth migrating. Extract any useful GitHub Actions workflows into the new `knowledge/guides/` or a re-created `.github/` with only the essential workflows.

## Acceptance Criteria

### AC-1: All AI Vendor Dirs Removed
**Given** the aikami monorepo root contains `.ai`, `.claude`, `.cursor`, `.gemini`, `.qwen`, `.zed`, `.opencode`, `.agent`, `.agents`, `openspec`
**When** the cleanup script runs
**Then** none of these directories exist in the repo root

**Test Hooks**:
- Unit: Verify `ls -d .ai .claude .cursor .gemini .qwen .zed .opencode .agent .agents openspec` returns "No such file or directory"
- Unit: Verify stale root files (AGENTS.md, CLAUDE.md, etc.) are removed

**Watch Points**:
- Ensure `.github/` is reviewed for CI workflows before deletion
- Ensure `.gitignore` entries for removed dirs are cleaned up
- Do NOT remove `.pi/`, `.moon/`, `.git/`, `.editorconfig`, `.gitignore`, `.env`, `.syncpackrc`

### AC-2: Root Directory Is Clean
**Given** all AI vendor directories have been removed
**When** listing the root directory
**Then** only project-relevant directories and files remain (packages/, apps/, config/, .pi/, .moon/, knowledge/, scripts/, package.json, biome.json, tsconfig.json, flake.nix, etc.)

**Test Hooks**:
- Unit: `ls -la` output matches expected clean root structure

### AC-3: .gitignore Updated
**Given** stale .gitignore entries reference removed vendor dirs
**When** the cleanup is complete
**Then** .gitignore no longer references removed directories or patterns

**Test Hooks**:
- Unit: grep for removed directory names in .gitignore returns no results (or only relevant ones)

## Implementation Notes

1. **Script**: Create a cleanup script at `scripts/src/lib/cleanup_vendor_dirs.ts` that runs the removals
2. **Order**: Run this contract FIRST before any other refactoring
3. **Backup**: Consider making a git commit before running cleanup so changes are reversible
4. **Preserve moves**: Any skills being migrated to `.pi/skills` should be moved (not deleted) — this is handled by contract C-004
