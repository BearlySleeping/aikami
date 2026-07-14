<!-- completed: 2026-07-06 -->
# Contract C-303: Self-Healing Visual Test Harness

## Metadata
- **Source**: Autonomous Testing Research Framework
- **Target**: .pi/runners/test_healer.ts
- **Priority**: P1 (Foundation)
- **Dependencies**: C-011, C-181, C-182, C-300

## Overview
Deploy an autonomous self-healing visual test runner script at `.pi/runners/test_healer.ts` running inside a persistent herdr sub-agent tab. The script executes visual regression checking suites via Moon, intercepts layout exceptions and screenshot differences, enforces a strict two-strike anti-loop threshold, triggers localized component diagnostics, and outputs a complete failure context payload to drive automated repairs.

## Design Reference
Follow the declarative validation structures established in `apps/e2e/src/visual/runner.ts`. Align herdr notification messages with the socket reporting schemas configured in `herdr-orchestrator.ts`.

## Architecture Directives
- Parse browser execution output streams line-by-line using Bun's native asynchronous subprocess decoding.
- Programmatically map screenshot validation failure patterns, extracting actual vs. expected layout boundaries and difference image arrays.
- On confirmed loop detection, halt pipeline progress, update herdr tab states to `blocked`, and trigger workspace toast alerts.

## State & Data Models
```typescript
export interface VisualMismatchDiff {
    testFile: string;
    testName: string;
    expectedSnapshotPath: string | null;
    actualSnapshotPath: string | null;
    differenceDiffPath: string | null;
    rawErrorOutput: string;
}

export interface StructuredHealingContext {
    timestamp: string;
    moonTargetTask: string;
    totalAttemptsCount: number;
    visualMismatches: VisualMismatchDiff[];
    diagnosticMetrics: {
        suspectedComponent: string;
        layoutParameters: string[];
        viewportWidth: number;
        viewportHeight: number;
    };
}
```

## Scope Boundaries
- **In Scope**: Stream log scraping, failure signature compilation, forcing Moon cache bypasses via `--force`, generating `.pi/healing_context.json`, and signaling herdr alerts.
- **Out of Scope**: Direct source file rewriting, editing screenshot image pixels, or deploying production assets.

## Acceptance Criteria

### AC-1: Automated Stream Interception and Signature Parsing
**Given** A visual testing suite execution path that fails due to element misalignment.
**When** The test healer captures the process stdout/stderr.
**Then** It must incrementally decode the logs, parse Playwright mismatch indicators, isolate the image paths for actual, expected, and diff configurations, and extract the layout signature.

**Test Hooks**:
- Moon Task: `bun run .pi/runners/test_healer.ts apps/e2e:validate`
- Integration: Verify generation of `.pi/healing_context.json` upon failure
- E2E / Visual: N/A

### AC-2: Anti-Loop Cached Bypass Enforcement and Escalation Handshake
**Given** An initial validation run has logged a component mismatch signature.
**When** A secondary retry pass fails with an identical component error pattern.
**Then** The script must flag a persistent regression loop, generate the full structured healing context payload on disk, dispatch a herdr workspace toast, and exit with status code 255 to signal parent escalation.

**Test Hooks**:
- Moon Task: `bun run .pi/runners/test_healer.ts test:loop_escalation`
- Integration: Validate herdr interface color conversion to `blocked`
- E2E / Visual: N/A

**Watch Points**:
- Ensure all raw logs pass through an ANSI stripping utility routine to prevent terminal escape sequences from corrupting the regex pattern matching engines.

## Implementation Sequence
1. **Phase 1 (Data/Logic)**: Build out stream reader architectures and create the error log pattern matchers.
2. **Phase 2 (Integration)**: Wire in the automated herdr notification calls and map exit code escalations.
3. **Phase 3 (Validation)**: Force mock component failures to verify the two-strike anti-loop protocol triggers cleanly.

## Edge Cases & Gotchas
- **Flaky Canvas Renderings**: Micro-adjustments in GPU antialiasing can cause transient visual check failures. The forced secondary run via `--force` is mandatory to validate failure stability before blocking execution loops.

---

## Execution Report — 2026-07-06

### Summary
Created autonomous self-healing visual test runner at `.pi/runners/test_healer.ts`. Executes visual test suites via Moon, intercepts Playwright mismatch output, enforces two-strike anti-loop protocol, and generates `.pi/healing_context.json` on persistent failure.

### AC Status
| AC | Status |
|----|--------|
| AC-1: Automated Stream Interception & Signature Parsing | ✅ Implemented |
| AC-2: Anti-Loop Cached Bypass Enforcement | ✅ Implemented |

### Files
| File | Change |
|------|--------|
| `.pi/runners/test_healer.ts` | Created — Stream interception, mismatch parsing, two-strike escalation, herdr alert dispatch |

### Tests
```
✅ pi:fix        — Clean
✅ pi:typecheck  — 0 errors
```

