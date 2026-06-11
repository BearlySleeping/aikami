# Contract: C-073 — LPC Visual Smoke Harness and AI Evaluation Pipeline

## Metadata
- Source: PWA Frontend Component Quality Audit
- Target: apps/e2e, scripts
- Priority: P1 (Foundation Automation)
- Dependencies: C-050, C-051, C-052
- Status: not_started
- Contract Version: 1.0.0

## Overview
The LPC sprite composition pipeline is highly sensitive to layer ordering, grid stride alignments, and tint-packing parameters. This contract establishes a dedicated end-to-end visual smoke-testing harness by unblocking and migrating the foundation laid in C-050. It utilizes the unified Playwright E2E package to load specific character component recipes in isolation, capture headless screenshots, and pass them to an AI Visual Specialist (Gemini 2.0 Flash via OpenRouter) to calculate a rendering fidelity score (0-100) and return explicit structural discrepancy reports.

## Design Reference
- `references/visual-testing/scripts/ai_visual_validation.ts`: Canonical implementation of base64 WebP optimization, OpenRouter request construction, and multi-modal image evaluation prompting.
- `scripts/src/lib/ops/validate_lpc_visuals.ts`: The existing Gemini evaluation script created in C-050.
- `apps/e2e/playwright.config.ts`: Unified E2E test isolation project structure from C-052.

## Architecture Directives
- **LPC Smoke Test Suite Migration**: Migrate the existing `lpc_visual.spec.ts` from the PWA into the `apps/e2e` unified test runner package.
- **AI Visual Quality Evaluator Update**: Ensure the evaluation script reads the generated PNGs from `apps/e2e/test-results/` instead of the old PWA directory, optimizes them, and hits the multimodal LLM gateway.
- **Automated Quality Gate Task**: A Moon task mapping under the `e2e` or `scripts` project that orchestrates the headless browser run followed immediately by the AI grading evaluation loop.

## State & Data Models
The payload exchange between the local test harness and the Vision Evaluation Gateway must strictly conform to the following schema structure.

    interface VisualFidelityReport {
        recipeId: string;
        componentSlot: string;
        variantAssetId: string;
        score: number;
        passed: boolean;
        detectedAnomalies: string[];
    }

    interface OpenRouterVisionPayload {
        model: string;
        messages: Array<{
            role: "user";
            content: Array<
                | { type: "text"; text: string }
                | { type: "image_url"; image_url: { url: string } }
            >;
        }>;
    }

## Acceptance Criteria

### AC-1: Playwright Parameterized Isolation Capture
- Given the unified `apps/e2e` runner is configured
- When Playwright invokes the LPC smoke suite targeting the `component-lite` path with serialized URL parameters (e.g., `?l0=body:male_light&l1=hair:mohawk&visual-testing=true`)
- Then the browser must wait for `window.__PIXI_LOADED__`, strip all document chrome, suppress Vite error overlays, and output a pixel-accurate PNG snapshot to `apps/e2e/test-results/lpc-visual/`.
- Test Hook: Verification that running the Playwright command outputs non-zero byte PNG files.

### AC-2: Vision Prompting & Discrepancy Evaluation
- Given a captured component screenshot file in the `apps/e2e/test-results/` folder
- When the `validate_lpc_visuals.ts` script reads the image
- Then it must generate a structured multi-modal request containing the base64 data string, append explicit layer alignment/edge blending guidelines, and POST to the LLM gateway.
- Test Hook: Validation that the script outputs a consolidated `report.json` with per-config scores, acceptability flags, and specific anomalies detected (e.g., "Seam separation at the wrist boundary").

### AC-3: Automated Quality Gate Integration
- Given an execution run of the complete smoke pipeline task
- When the vision model returns a JSON completion body with a composition score below 90
- Then the script must write a localized entry to the evaluation report, print the discrepancies directly to the terminal stdout, and exit with a non-zero process code to halt the pipeline.
- Test Hook: Verification that a forced malformed mock generation drops the score below 90 and triggers a task failure.

## Implementation Notes
1. Move the legacy `apps/frontend/client/tests/lpc_visual.spec.ts` into `apps/e2e/tests/client/` to align with the C-052 unified test runner pattern.
2. Update the `validate_lpc_visuals.ts` script to target the new `apps/e2e/test-results/lpc-visual/` directory.
3. Verify the prompt inside the validation script instructs the AI to return the specific JSON schema (score, passed, visualDiscrepancies).
4. Add a `test:visual` or `lpc:smoke` command to `apps/e2e/package.json` and its `moon.yml` to orchestrate this flow.

## Edge Cases & Gotchas
- **VRAM/Canvas Sync Race**: Capturing a screenshot before the texture loader finishes WebGL composition results in a blank canvas. The test must strictly poll `window.__PIXI_LOADED__`.
- **Vite Overlay Interception**: Uncaught runtime warnings can spawn a DOM error overlay. Inject CSS to `display: none` the `.vite-error-overlay` element prior to capturing.
- **Nix Headless Browsers**: Since C-046 fixed the chromium wrapper, ensure the E2E Playwright config uses the system chromium executable if necessary.
