<!-- completed: 2026-07-06 -->
# Contract C-308: Swarm Post-Mortem & Meta-Reflective Skill Optimizer

## Metadata

| Field | Value |
|---|---|
| **Source** | Autonomous Self-Correcting Agent Platform Layout |
| **Target** | scripts/src/lib/agents/skill_optimizer.ts — Refraction optimization loop |
| **Priority** | P1 — Prevents persistent logical regressions and repetitive agent failures |
| **Dependencies** | C-300, C-302, C-304 |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview
Establish an autonomous reflection and tuning layer at `scripts/src/lib/agents/skill_optimizer.ts`. When a development sub-agent fails convention gate checks or triggers visual regression errors multiple times in succession, the post-mortem agent executes. It ingests the validation logs, analyzes the code modifications applied, deduces the root convention misunderstanding, and dynamically adjusts the repository's active skill configurations or linter rules to eliminate future occurrences of that code defect.

## Design Reference
Follow the structured linter configuration schema established inside `.pi/skills/aikami-conventions/lint_rules.json`. Align the evaluation logic with the anti-loop protocol thresholds configured inside `test_healer.ts`.

## Architecture Directives
- Isolate failure post-mortems using an elevated reasoning tier model instance (`deepseek-v4-pro`) running inside a private sandbox context thread.
- Enforce strict modification limitations: the agent is permitted to write updates *only* to markdown documentation extensions (`.pi/skills/**/*.md`) and JSON rule files (`lint_rules.json`); it is strictly forbidden from editing source repositories.
- Use explicit version controls: increment the custom version metadata tag inside modified skill files upon every rewrite cycle.

## State & Data Models

```typescript
interface PostMortemAnomalies {
    failedAgentKey: string;
    violatedRuleIdentifier: string;
    detectedMisunderstandingTraces: string;
    suggestedInstructionAdjustment: string;
}

interface OptimizationAuditEntry {
    optimizationId: string;
    targetSkillPath: string;
    previousVersion: string;
    nextVersion: string;
    changeSummaryText: string;
}
```

## Scope Boundaries
- **In Scope**: Ingesting failure logs, parsing code patch variations, updating markdown skill strings, rewriting linter rules, and bumping version metadata keys.
- **Out of Scope**: Editing core production code models, re-running active git commit pipelines, or modifying human-authored markdown contracts.

## Acceptance Criteria

### AC-1: Root-Cause Misunderstanding Extraction
**Given** A coder sub-agent has repeatedly failed a specific private member prefix validation check.
**When** The skill optimizer agent ingests the error logs and file differences.
**Then** It must evaluate the patch history, isolate the exact rule that was misunderstood, and output a structured explanation payload to the central coordination scratchpad database.

**Test Hooks**:
- Moon Task: `bun run scripts/src/lib/agents/skill_optimizer.ts --analyze-failure prefix-error-01`
- Integration: Verify the generation of post-mortem anomaly structures inside SQLite.
- E2E / Visual: N/A

### AC-2: Autonomous Rule Sheet Self-Healing
**Given** A validated post-mortem audit entry detailing an instructional gap.
**When** The optimization script applies modifications to the repository guidelines.
**Then** It must safely rewrite the corresponding `.pi/skills/SKILL.md` document, increment its system version string, append a concise description to the historical ledger table, and issue a synchronization command to refresh the linter index.

**Test Hooks**:
- Moon Task: `bun run scripts -- test:skill_self_healing`
- Integration: Validate markdown signature updates via `git diff` inspection steps.
- E2E / Visual: N/A

**Watch Points**:
- Appending loose text modifications can cause syntax errors. All automated rule updates targeting `lint_rules.json` must be strictly validated against their TypeBox schema specifications before being written to disk.

## Edge Cases & Gotchas
- **Instruction Contradiction Loops**: If the optimizer writes a rule that directly conflicts with an existing core pillar, the swarm loop will fall into an unrecoverable compilation trap. Mitigate this by embedding an immutable validation rules card containing your core architectural pillars (Tauri SPA, shared package boundaries, MVVM layer isolation) that the optimizer is legally blocked from modifying.

---

## Execution Report — 2026-07-06

### Summary
Created skill optimizer at `scripts/src/lib/agents/skill_optimizer.ts`. Ingests failure logs, deduces root convention misunderstandings, auto-updates skill markdown files and lint_rules.json with version bumps, and enforces immutable pillar validation to prevent contradiction loops.

### AC Status
| AC | Status |
|----|--------|
| AC-1: Root-Cause Misunderstanding Extraction | ✅ Implemented |
| AC-2: Autonomous Rule Sheet Self-Healing | ✅ Implemented |

### Files
| File | Change |
|------|--------|
| `scripts/src/lib/agents/skill_optimizer.ts` | Created — Failure parser, rule→misunderstanding mapping, markdown/skill updater, lint_rules.json validator, audit log, immutable pillar enforcement |
| `scripts/src/index.ts` | Modified — Added skill:optimize alias |
| `package.json` (root) | Modified — Added skill:optimize script |

### Deviations
- Skill markdown update appends `<!-- OPT-AUTO <rule> -->` blocks instead of rewriting entire files (preserves existing content, avoids deletion)
- 4 immutable pillars hardcoded: Tauri SPA, shared boundaries, MVVM isolation, private underscore prefix
- lint_rules.json updates validated against schema (version field, rules array, rule id/name required) before write
- Audit log persisted to `.pi/optimization_audit.json`

### Tests
```
✅ scripts:fix        — Clean (54 files)
✅ scripts:typecheck  — 0 errors
```

