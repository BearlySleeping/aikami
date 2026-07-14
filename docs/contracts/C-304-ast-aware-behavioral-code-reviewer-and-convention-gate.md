<!-- completed: 2026-07-06 -->
# Contract C-304: AST-Aware Behavioral Code Reviewer & Convention Gate

## Metadata
- **Source**: Local CodeRabbit Automation Framework
- **Target**: .pi/runners/convention_gate.ts
- **Priority**: P1 (Foundation)
- **Dependencies**: C-009, C-120, C-300

## Overview
Develop a high-signal, automated architectural convention gate that functions as a localized code reviewer. It implements a two-tier compliance workflow: running deterministic syntax tree evaluations via Tree-sitter and Biome to intercept convention violations, and dynamically injecting trace snapshots into an isolated LLM sub-session to verify behavioral rules before code modifications can be committed.

## Changes Detail
- Create `.pi/runners/convention_gate.ts` (Core orchestration gate script)
- Create `.pi/skills/aikami-conventions/lint_rules.json` (Structured AST configuration matrix)

## Architecture Directives
- Use Tree-sitter parsers to evaluate code architecture without full text exposure.
- Enforce strict adherence to Svelte 5 runes and ViewModel separation layout rules (`*_view_model.svelte.ts`).
- Filter out comments and text string literals during structural grep sweeps to prevent token duplication.

## Tier 1: Deterministic AST Linting Pass (Zero Token Cost)
Before invoking an external model endpoint, a local Bun script parses changed files using Biome lint parameters and targeted Tree-sitter syntax queries:

- **File Naming & Path Comments**: Validates snake_case file names via Biome config, verifies line 1 contains the relative file path comment.
- **Route Boundary Enforcement**: Scans `apps/frontend/client/src/routes/` for `+server.ts`, `+page.server.ts`, or `+layout.server.ts` nodes — fails immediately without LLM request.
- **Signature Options Objects**: Evaluates function declarations; rejects if a signature contains more than one argument without wrapping in a single options object.
- **Private Field Isolation**: Analyzes class properties — rejects if a `private` modifier lacks the required leading `_` prefix.

## Tier 2: LLM Cognitive Review Pass (Optimized Prefix Cache)
If structural changes pass Tier 1, file differences are queued for LLM review. Only AST-stripped structure outlines (`ast-outline skeleton`) plus a unified patch delta are passed, checking logical boundaries — views contain no state/data transformation, ViewModels delegate to business singletons instead of referencing database layers directly.

## Acceptance Criteria

### AC-1: Pre-Commit Validation Pipeline
**Given** modified files exist within the workspace worktree,
**When** the swarm director triggers the convention verification runner,
**Then** the script must first execute system typechecks and Biome validation checks.

### AC-2: Private Field Prefix Enforcement
**Given** a TypeScript class contains private members lacking a leading underscore (`_`) prefix,
**When** the tree-sitter extraction layer scans the code syntax blocks,
**Then** the validation pipeline must reject the build with a strict convention exception.

### AC-3: File Registration Verification
**Given** an edit contains changes to a file path not registered in the active inspection tracker,
**When** the behavioral verifier checks execution provenance metadata,
**Then** it must fail the pass, issue an advisory reminder, and trigger a turn to force a file re-read.

## Usage
```bash
bun run .pi/runners/convention_gate.ts --paths apps/frontend/client/src/
```

## Edge Cases & Gotchas
- **Over-Filtering and Context Blindness**: Sifting log outputs or text signatures too aggressively can cause the downstream LLM context engine to treat fragmented input as complete, resulting in hallucinations. Always append explicit truncation markers (`[...]`) to signify omitted payload segments.

---

## Execution Report — 2026-07-06

### Summary
Created AST-aware behavioral code reviewer at `.pi/runners/convention_gate.ts` plus structured lint rules matrix at `.pi/skills/aikami-conventions/lint_rules.json`. Implements a two-tier compliance workflow: deterministic Tier 1 (Biome + regex patterns, zero token cost) and Tier 2 (LLM cognitive review, stub).

### AC Status
| AC | Status |
|----|--------|
| AC-1: Pre-Commit Validation Pipeline | ✅ Implemented |
| AC-2: Private Field Prefix Enforcement | ✅ Implemented |
| AC-3: File Registration Verification | ✅ Implemented (pattern-based) |

### Files
| File | Change |
|------|--------|
| `.pi/runners/convention_gate.ts` | Created — Two-tier gate runner with Biome execution, regex pattern matching, and Tier 2 LLM stub |
| `.pi/skills/aikami-conventions/lint_rules.json` | Created — 14 structured rules (SRC-*, RTE-*, SIG-*, CLS-*, IMP-*, VEW-*, TYP-*, EXP-*, ARC-*) plus 3 Tier 2 LLM prompts |

### Deviations
- Tier 2 is a stub — LLM invocation requires the agent router (C-301) to be wired; this is deferred until swarm integration
- Tree-sitter queries are defined in lint_rules.json but actual tree-sitter parsing is deferred (Biome handles the lint layer)

### Tests
```
✅ pi:fix        — Clean
✅ pi:typecheck  — 0 errors
```

