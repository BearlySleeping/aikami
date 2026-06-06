| Metadata | Value |
| --- | --- |
| Source | User |
| Target | apps/frontend/pwa |
| Priority | High |
| Dependencies | C-034, C-042 |
| Status | not_started |
| Version | 1.0 |

# Overview
Establish a visual testing harness for the Universal LPC Spritesheet Character Generator. This involves making the existing dev component URL-driven, creating a minimal "lite" version for isolated rendering, and setting up a Playwright + AI validation pipeline to automatically grade the visual correctness of layered sprites.

# Design Reference
- `references/visual-testing/scripts/ai_visual_validation.ts` for the LLM evaluation pattern.
- `apps/frontend/pwa/src/routes/(dev)/dev/lpc/component/+page.svelte` for the existing (buggy) implementation.
- Universal LPC Spritesheet Character Generator URL parameter patterns (e.g., `?body=Body_Color_light&head=Human_Male_light`).

# Architecture Directives

## LPC Dev Component (Update)
Update the existing LPC dev route to synchronize its UI state with URL search parameters. If a parameter changes, the component should update. If the UI changes, the URL should push a new state so configurations are easily shareable.

## LPC Lite Route (New)
Create a new route designed strictly for visual testing. It must:
- Have zero UI chrome (no sidebars, headers, or controls).
- Read configuration entirely from URL search parameters.
- Support a `zoom` parameter to scale the PixiJS canvas for easier visual inspection.
- Center the rendered character.

## Visual Test Suite
Create a Playwright test suite dedicated to the LPC renderer. It should navigate to the Lite Route with predefined combinations (e.g., "just body", "body + head", "full armor set + colored hair") and capture screenshots.

## AI Visual Validation Script
Adapt the pattern from our visual testing references to create a script that takes the Playwright screenshots and sends them to our AI service (Gemini). The prompt should instruct the LLM to verify layer alignment, clipping, and color tinting, outputting a JSON validation report with a confidence score and detected anomalies.

# State & Data Models

    // Expected URL Search Param mapping concept
    interface LpcUrlConfig {
        zoom: number;         // default: 1
        body?: string;        // e.g., "Body_Color_light"
        head?: string;        // e.g., "Human_Male_light"
        hair?: string;
        hair_color?: string;  // hex color for tinting
        torso?: string;
        legs?: string;
        feet?: string;
        expression?: string;
    }

    // AI Validation Output Concept
    interface LpcVisualReport {
        config_id: string;
        score: number; // 0-100
        issues_detected: string[]; // e.g., ["Hair is rendering behind the head", "Tint color is completely masking texture details"]
        is_acceptable: boolean;
    }

# Acceptance Criteria

- **AC1: URL State Sync (Main Component)**
  - **Given** a user navigates to the LPC dev component with search params
  - **When** the page loads
  - **Then** the UI controls and the rendered character initialize to match the URL params.

- **AC2: LPC Lite Route Rendering**
  - **Given** a Playwright test
  - **When** it navigates to the LPC Lite Route with specific body part and zoom params
  - **Then** only the character is rendered, scaled to the zoom level, with no other HTML UI elements visible.

- **AC3: Playwright Screenshot Capture**
  - **Given** the visual test suite
  - **When** executed
  - **Then** it produces a set of reference screenshots in a predictable output directory for predefined layer combinations.

- **AC4: AI Visual Evaluation**
  - **Given** a set of captured LPC screenshots
  - **When** the AI validation script is run
  - **Then** it queries the LLM and outputs a consolidated JSON report scoring the visual correctness of each configuration.

# Implementation Notes
1. Define a robust serialization/deserialization helper for moving LPC state to and from `URLSearchParams`.
2. Update the existing dev page to use this helper alongside SvelteKit's `page` store or `goto(..., { keepFocus: true, replaceState: true })`.
3. Create the Lite Route, stripping the layout using SvelteKit's `@` syntax if necessary, or just rendering a blank canvas container.
4. Implement the Playwright test to hit 3-4 distinct configurations (e.g., naked body, heavily layered knight, tinted hair/eyes).
5. Write the Node/Bun script utilizing `@google/genai` (or our internal wrapper) to evaluate the screenshots. The prompt needs to be highly specific about what a correct 2D RPG sprite should look like.

# Edge Cases & Gotchas
- **PixiJS Initialization Delay:** Ensure Playwright waits for the PixiJS canvas to fully render the textures before taking the screenshot. We may need to expose a `window.__PIXI_LOADED__` flag or wait for a specific class to be applied to the canvas container.
- **URL Param Length:** Complex characters might result in long URLs. Stick to concise key names if possible, but prioritize clarity.
