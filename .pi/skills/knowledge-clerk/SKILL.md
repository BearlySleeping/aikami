---
name: knowledge-clerk
description: >-
  Manages Aikami's knowledge architecture — the knowledge/ repo inside the main codebase.
  Pulls latest knowledge before work, regenerates llms.txt after doc changes, validates contract format,
  ensures CONTEXT.md is fresh, and pushes doc changes to keep external AI tools in sync.
  Use when: making doc changes, after implementing a feature, before starting a work session,
  or when told "sync the docs."
---

# Knowledge Clerk

Maintains Aikami's AI-first knowledge architecture across two repos cloned alongside each other.

## Architecture

```
aikami/                          # Main repo
├── apps/                          # Production code
├── packages/                      # Shared libraries
├── scripts/                       # Build tooling
├── knowledge/                     # Gitignored — separate repo (aikami-knowledge)
│   ├── llms.txt                   # Auto-generated index
│   ├── CONTEXT.md                 # 2-page AI briefing
│   ├── contracts/                 # Feature contracts
│   ├── decisions/                 # Architecture Decision Records
│   ├── design/                    # Lovable design specs
│   │   ├── landing/
│   │   ├── pwa/
│   │   └── micro-tools/
│   ├── architecture/              # System design docs
│   ├── guides/                    # How-to guides
│   ├── intro/                     # Vision, setup
│   ├── lovable/                   # Lovable context
│   └── tickets/                   # Bug/feature templates
├── .gitignore                     # knowledge/ is ignored
└── .pi/skills/                    # Pi skills
```

## When to Activate

This skill activates:
- **At the start of every pi session** — pull latest docs
- **After implementing a feature** — regenerate llms.txt, update CONTEXT.md if needed
- **When a contract is created or completed** — update CONTRACTS index, regenerate llms.txt
- **Before pushing code** — ensure docs are in sync
- **When told "sync the docs"** or "update llms.txt"

## Workflow

### Phase 1: Pull Latest (Session Start)

```bash
# Pull knowledge repo
cd knowledge && git pull --rebase
```

Check for external AI changes:
```bash
cd knowledge && git log --oneline -10
# Look for [manus-clerk] and [lovable] tags
```

Report: "Pulled N changes from knowledge repo. Latest: {summary}"

### Phase 2: Regenerate Index (After Doc Changes)

After ANY change to files in the knowledge repo:

```bash
cd knowledge && bun run scripts/generate_llms_txt.ts
```

1. Verify `llms.txt` updated correctly (check file count matches)
2. Stage `llms.txt` along with the doc changes
3. If the change is significant (new contract, major architecture change):
   - Review `CONTEXT.md` — does it need updating?
   - Update "Current Phase" or "Active Contracts" sections as needed

### Phase 3: Validate Contracts

When creating or editing a contract in `knowledge/contracts/`:

2. Verify the contract has all 6 sections:
   - [ ] Overview + Design Reference
   - [ ] Data Model
   - [ ] Acceptance Criteria (with Given/When/Then + test hooks)
   - [ ] Visual Regression Criteria
   - [ ] Implementation Notes
   - [ ] Edge Cases & Gotchas
3. Verify naming: `{source}--{feature-slug}.md` where source is `pwa`, `landing`, `shared`, or `functions`
4. Update `knowledge/contracts/INDEX.md` if adding a new contract

### Phase 4: Push (Explicit Instruction Only)

Only push doc changes when explicitly instructed. When pushing:

1. Ensure `llms.txt` is regenerated and staged
2. Ensure `CONTEXT.md` is up to date (if significant changes)
3. Commit with message: `docs: {what changed} [knowledge-clerk]`
4. Push

## Key Rules

### llms.txt is AUTO-GENERATED — never edit by hand
Run the generator in the knowledge repo: `cd knowledge && bun run scripts/generate_llms_txt.ts`

### CONTEXT.md is CURATED — edit by hand when needed
Update when: new contracts added, phase changes, stack changes, major limitation resolved.

### Two-Repo Model
Knowledge lives in `knowledge/` inside the main repo (gitignored, separate remote).
No submodules, no symlinks, no CI sync scripts.

### External AI Workflow
```
Manus reads  → knowledge/llms.txt → finds files → writes contracts/
Lovable reads → knowledge/design/ context → writes design specs
Pi reads     → knowledge/contracts/ → implements in main repo
```

### Prompt Templates
Prompt templates for Martin to use with Manus/Lovable live in `.github/prompts/`:
- `manus-contract.md` — How to write a new contract
- `manus-query.md` — How to read/query the docs
- `lovable-design-spec.md` — How to write design specs

## File Map

| File | Repo | Purpose | Auto/Manual |
|------|------|---------|-------------|
| `llms.txt` | knowledge | Index of all knowledge files | **Auto-generated** |
| `CONTEXT.md` | knowledge | 2-page AI briefing | **Manual** |
| `scripts/generate_llms_txt.ts` | knowledge | Generator script | Run after doc changes |
| `contracts/INDEX.md` | knowledge | Contract priority + status | **Manual** |
| `contracts/TEMPLATE.md` | knowledge | Contract format template | Static |

## Auto-Sync (Moon Hooks)

Moon automatically pulls the knowledge repo on every `git checkout` and `git merge`:

```yaml
# .moon/workspace.yml
post-checkout:
  - "cd knowledge && git pull --rebase"
post-merge:
  - "cd knowledge && git pull --rebase"
```

You never need to manually pull — it happens automatically when you switch branches or pull main.

## Quick Commands

```bash
# Pull knowledge + regenerate index\ nbun run knowledge:pull

# Push knowledge changes (manual only)
bun run knowledge:push

# See what's happening in knowledge repo
bun run knowledge:status

# Setup Lovable projects (run once)
bun run lovable:setup

# Sync all Lovable projects + knowledge
bun run lovable:sync
```

## Manual Checks

```bash
# See recent knowledge commits
cd knowledge && git log --oneline -10

# Only Manus commits
cd knowledge && git log --oneline --grep="manus"

# Validate contracts have all required sections
grep -L "## Data Model" knowledge/contracts/*.md

# Count files
find knowledge -name "*.md" | wc -l
```

## Sync Cycle

```
Manus:   cd knowledge && git pull → read llms.txt → write specs → git push
Pi:      cd knowledge && git pull → bun scripts/generate_llms_txt.ts → read contracts → implement
Lovable: cd knowledge && git pull → write design/ → git push
```

When you see external commits in knowledge/:
1. `cd knowledge && git pull && bun run scripts/generate_llms_txt.ts`
2. Read the new/changed contracts or design specs
3. The contract-implementer skill picks them up automatically
