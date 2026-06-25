## Metadata

| Field | Value |
|---|---|
| **Source** | Architect UX Polish |
| **Target** | `apps/frontend/client/src/lib/views/combat/components/` — Combat Log & Imagery |
| **Priority** | P1 — Narrative Immersion |
| **Dependencies** | C-164 |
| **Status** | ✅ completed |
| **Contract version** | 1.0.0 |

## Overview

To make combat feel like a dynamic comic book, custom actions that generate high-impact narrative outcomes will now spawn in-line generated images directly inside the combat log. We also need a "Gallery" toggle to view all generated images for the current encounter.

## Design Reference

Image generation service calls from Character Creation (C-123).

## Architecture Directives

- **In-Line Images**: Update the `CombatLog` component. When a turn resolves, if an image URL is present in the turn data, render it inline between the player's action text and the AI's outcome description.
- **Hover Tooling**: Wrap the in-line image in a container that reveals a Svelte overlay on `:hover`. The overlay should contain an `Expand` (view fullscreen) and `Regenerate` button (triggers a new background image generation call using the same prompt).
- **Encounter Gallery**: Build `combat_gallery.svelte`. When the user toggles the header from "Log" to "Gallery", hide the text feed and render a CSS Masonry grid of all image URLs in the current `CombatState`.

## State & Data Models

    export interface CombatLogEntry {
        id: string;
        turnNumber: number;
        actor: string;
        actionText: string;
        outcomeText: string;
        imageUrl?: string; // New field for in-line imagery
        isGeneratingImage?: boolean;
    }

## Acceptance Criteria

### AC-1: In-Line Image Rendering
**Given** a combat turn resolves with a custom action
**When** the image generation service returns a URL
**Then** the image fades into the combat log stream, pushing older text upward.

### AC-2: Hover Tooling
**Given** an in-line image is visible
**When** the user hovers over it
**Then** a "Regenerate" and "Expand" button appear, and clicking Regenerate replaces the image without altering the text log.

### AC-3: Gallery Toggle
**Given** multiple turns have passed and generated images
**When** the user clicks the "Gallery" tab
**Then** the text log is hidden and a masonry grid of the generated images is displayed.

**Test Hooks**:
- Unit: Mock the image generation service to return a static URL and verify the `CombatLogEntry` state updates and renders the `<img>` tag.

## Implementation Notes

1. **Files to create**: `combat_gallery.svelte`, `combat_inline_image.svelte`
2. **Files to modify**: `combat_view_model.svelte.ts` (to trigger image gen asynchronously after text resolution).

## Edge Cases & Gotchas

- **Scroll Jumping**: When the image finally loads and gets its height, the scroll container might jump. Set a fixed `min-height` placeholder or skeleton loader for the image while `isGeneratingImage` is true.
