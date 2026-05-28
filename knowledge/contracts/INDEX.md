# Contracts — Aikami Monorepo Refactoring

Monorepo restructuring contracts for aikami. Each contract defines a complete refactoring task with:
- Metadata (source, target, priority, dependencies)
- Design reference (nordclaw pattern)
- Acceptance criteria with Given/When/Then + test hooks
- Implementation notes
- Edge cases & gotchas

## Priority Ordering

Contracts are ordered by dependency chain — execute in this order:

```
P0 (Blocking — must do first):
  C-001 → C-002 → C-003 → C-004

P1 (Foundation — after P0):
  C-005 → C-006 → C-007 → C-008 → C-009

P2 (Polish — after P1):
  C-010 → C-011 → C-012
```

## Contracts Index

### 🟢 P0 — Cleanup & Foundation (Blocking)

| # | Contract | Description | Depends On |
|---|----------|-------------|------------|
| C-001 | [Remove AI Vendor Directories](C-001-remove-ai-vendor-dirs.md) | Remove .ai, .claude, .cursor, .gemini, .qwen, .zed, .opencode, .agent, .agents, openspec, .github, .github_old, and stale root files | — |
| C-002 | [Establish Knowledge Directory](C-002-establish-knowledge-dir.md) | Create knowledge/ with architecture, contracts, decisions, guides, intro subdirectories | C-001 |
| C-003 | [Establish .pi Setup](C-003-establish-pi-setup.md) | Create .pi/ with extensions, skills, agents, prompts, settings.json, mcp.json | C-001, C-002 |
| C-004 | [Migrate Skills to .pi/skills](C-004-migrate-skills.md) | Move .agents/skills → .pi/skills, copy engineering skills from nordclaw | C-001, C-003 |

### 🟡 P1 — Structure & Configuration (Foundation)

| # | Contract | Description | Depends On |
|---|----------|-------------|------------|
| C-005 | [Restructure Packages Under packages/shared](C-005-restructure-packages-shared.md) | Move constants, logger, mocks, schemas, types, utils to packages/shared/; remove packages/backend/ai | C-001 |
| C-006 | [Add packages/frontend/configs](C-006-add-frontend-configs-package.md) | Create frontend configs package following nordclaw pattern | C-005 |
| C-007 | [Establish Scripts Project](C-007-establish-scripts-project.md) | Create scripts/ with moon.yml, setup script, dev script, generate_llms_txt | C-001, C-005 |
| C-008 | [Copy .moon Setup from Nordclaw](C-008-copy-moon-setup.md) | Add task templates, git hooks, inherited tasks, enhance workspace.yml | C-005, C-006, C-007 |
| C-009 | [Standardize moon.yml and tsconfig.json](C-009-standardize-moon-tsconfig.md) | Standardize all project configs to nordclaw pattern | C-005, C-006, C-007, C-008 |

### 🔵 P2 — Quality of Life & Tooling

| # | Contract | Description | Depends On |
|---|----------|-------------|------------|
| C-010 | [Setup Script](C-010-setup-script.md) | Interactive developer onboarding script | C-007, C-008 |
| C-011 | [Blackbox Testing Infrastructure](C-011-blackbox-testing.md) | E2E testing with Playwright, Firebase emulators, visual regression | C-007, C-009 |
| C-012 | [Generate llms.txt and CONTEXT.md](C-012-generate-llms-and-context.md) | AI-first file index and project briefing | C-002, C-007 |

## Contract Format

All contracts follow `TEMPLATE.md`. Each contract answers:

| Question | Section |
|----------|---------|
| **What is this?** | Overview + Design Reference |
| **What changes?** | Changes detail (directories, files, configs) |
| **How do we know it works?** | Acceptance Criteria (Given/When/Then + test hooks) |
| **Where does it go?** | Implementation Notes |
| **What breaks?** | Edge Cases & Gotchas |

## Usage

```bash
# View all contracts
ls knowledge/contracts/

# Read a specific contract
cat knowledge/contracts/C-001-remove-ai-vendor-dirs.md

# Check progress
grep -r "Status" knowledge/contracts/C-*.md | grep -v "not_started"
```
