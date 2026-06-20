## Metadata

| Field | Value |
|---|---|
| **Source** | Architect MVP Polish |
| **Target** | `apps/e2e/tests/client/demo_happy_path.spec.ts` |
| **Priority** | P1 — Final validation |
| **Dependencies** | C-157, C-158 |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Create a master end-to-end Playwright test that walks through the entire Demo Happy Path. This proves all systems (Auth, LLM Chat, ECS Engine, Combat, UI Overlays, Persistence) work seamlessly together without breaking.

## Design Reference

Use the existing `combat_sandbox.spec.ts` and `ai_eval.ts` for AI-based visual assertions where deterministic DOM assertions fall short.

## Architecture Directives

- Run via the Blackbox testing infrastructure.
- Mock the LLM endpoints using existing mock service configurations to prevent API credit drain and ensure fast, deterministic CI runs.
- Use Playwright's specific locators to walk through: Start Menu -> Setup (Character Creation) -> Game Canvas (Movement) -> Vendor (Buy item) -> NPC (Dialogue/Skill check) -> Combat -> Save Game.

## Acceptance Criteria

### AC-1: The Golden Path Completes
**Given** a fresh browser context and mocked backend
**When** the test executes the full player journey
**Then** it successfully navigates from start to saving the game, passing AI visual evaluations at key checkpoints (Character Sheet generated, Combat started, Game Saved).

**Test Hooks**:
- CI: This test must pass reliably in the standard GitHub Actions CI pipeline.

## Implementation Notes

1. **Files to create**: `apps/e2e/tests/client/demo_happy_path.spec.ts`
2. **Order of operations**:
   - Write the sequence using Playwright page actions.
   - Ensure you use `waitForSelector` or `waitForResponse` to handle async boundaries (like entering the game world after setup).
   - Leverage `evaluateScreenshot` at the end to confirm the UI is in a valid paused/saved state.

## Edge Cases & Gotchas

- **Canvas Movement**: Playwright cannot easily click elements inside the PixiJS canvas. Use `page.keyboard.press('KeyD')` to simulate movement.
- **Mocking**: Ensure the text generation mocks return exactly the expected JSON schemas so the UI doesn't break mid-test.
