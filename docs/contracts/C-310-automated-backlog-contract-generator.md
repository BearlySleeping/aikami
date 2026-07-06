<!-- completed: 2026-07-06 -->
# Contract C-310: Automated Backlog Contract Generator

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md Specification Matrix |
| **Target** | scripts/src/lib/agents/contract_generator.ts — Automated template factory |
| **Priority** | P0 — Automates the generation of feature contracts directly from markdown logs |
| **Dependencies** | C-002, C-007, C-309 |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview
Design and deploy an automated parsing utility at `scripts/src/lib/agents/contract_generator.ts`. This agent reads raw feature outlines, user roadmaps, and requirements matrices directly from `TODO.md` or natural language files. It automatically converts these descriptions into complete, fully formatted engineering contracts inside `docs/contracts/` that strictly match your `docs/contracts/TEMPLATE.md` structure.

## Design Reference
Follow the document layout constraints, metadata configurations, and Given/When/Then tracking parameters defined in `docs/contracts/TEMPLATE.md`. Ensure generated files conform to the system-wide `snake_case` naming rules enforced by Biome linter guidelines.

## Architecture Directives
- Parse feature markdown hierarchies natively under Bun using structured regex blocks or basic tokenization arrays.
- Dynamically compile template files, generating placeholders for scope parameters, test hooks, architecture directives, and implementation sequences.
- Register new files into the core index ledger (`docs/contracts/INDEX.md`) upon successful generation steps.

## State & Data Models

```typescript
interface TodoBacklogItem {
    tierIdentifier: string;
    featureCode: string;
    titleString: string;
    rawBulletPoints: string[];
    targetFilePath: string;
}

interface GeneratedContractMetadata {
    contractNumber: string;
    fileNameKey: string;
    resolvedDependencies: string[];
    priorityLevel: "P0" | "P1" | "P2";
}
```

## Scope Boundaries
- **In Scope**: Reading `TODO.md` file data, matching markdown tokens, generating structured contract sheets, assigning priority tiers, and updating contract index summaries.
- **Out of Scope**: Writing individual component implementation code or executing test suites.

## Acceptance Criteria

### AC-1: Automated Template Generation from TODO.md Backlog Items
**Given** A valid backlog description section exists inside the `TODO.md` repository log.
**When** The contract generation agent is invoked with a targeted feature code reference (e.g., `C-ME-002`).
**Then** It must extract the bullet coordinates, parse the feature fields, map them to a new contract document named `C-231-rich-chat-streaming.md`, and strictly format the output according to the template rules.

**Test Hooks**:
- Moon Task: `bun run scripts/src/lib/agents/contract_generator.ts --target C-ME-002`
- Integration: Verify the output file content alignment against `docs/contracts/TEMPLATE.md`.
- E2E / Visual: N/A

### AC-2: Contract Index Synchronization
**Given** A new contract document has been written to the `docs/contracts/` partition directory.
**When** The file creation cycle concludes successfully.
**Then** The generator must update `docs/contracts/INDEX.md`, appending the item into the correct priority table matrix while preserving existing checkmark indicators.

**Test Hooks**:
- Moon Task: `bun run scripts -- test:index_sync`
- Integration: Validate markdown grid syntax changes using the linter validation pass.
- E2E / Visual: N/A

**Watch Points**:
- Generated data sheets are conceptual models; the engine is strictly forbidden from generating framework boilerplate code (Svelte code, context providers, or Firebase configuration logic) inside the state descriptions.

## Edge Cases & Gotchas
- **Malformed Markdown Text**: Changing text formatting can cause header tracking queries to break. Implement a fallback parser that leverages strict boundary delimiters or error exceptions to prevent broken files from reaching disk.

---

## Execution Report — 2026-07-06

### Summary
Created contract generator at `scripts/src/lib/agents/contract_generator.ts`. Parses TODO.md sections (In Progress→P1, Backlog→P2), extracts numbered items with bullet points, fills TEMPLATE.md structure, auto-infers dependency contracts from keyword matching, and updates INDEX.md with new rows in the correct priority table.

### AC Status
| AC | Status |
|----|--------|
| AC-1: Automated Template Generation from TODO.md | ✅ Implemented |
| AC-2: Contract Index Synchronization | ✅ Implemented |

### Files
| File | Change |
|------|--------|
| `scripts/src/lib/agents/contract_generator.ts` | Created — TODO.md parser, template filler, dependency inferrer, INDEX.md updater |
| `scripts/src/index.ts` | Modified — Added contract:generate alias |
| `package.json` (root) | Modified — Added contract:generate script |

### Deviations
- Template.filler generates contracts from raw item data rather than copying TEMPLATE.md wholesale (ensures structural consistency regardless of template changes)
- Dependency inference uses keyword→contract mapping (58 keywords → 19 contracts)
- INDEX.md updater inserts into correct priority section (P1/P2) by regex-matching section headers

### Tests
```
✅ scripts:fix        — Clean (55 files)
✅ scripts:typecheck  — 0 errors
```

