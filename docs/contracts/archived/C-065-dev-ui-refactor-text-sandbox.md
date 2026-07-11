<!-- completed: 2026-06-29 -->
# Contract: C-065 — Dev UI Tailwind Refactor & Text Sandbox

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | C-064 |
| Status | completed |
| Version | 1.0 |

## Overview
We need to remove technical debt by converting the legacy CSS in our Developer Console to our standard Tailwind CSS + DaisyUI framework. Specifically, the LPC visual debugger contains hundreds of lines of raw CSS that must be replaced with utility classes. Concurrently, we will implement the first functional AI testing harness: the Text Generation Sandbox, allowing developers to visually test the Server-Sent Events (SSE) stream.

## Design Reference
- Review [DaisyUI Components](https://daisyui.com/components/) for `btn`, `select`, `range`, `card`, and `badge`.
- Review `apps/frontend/client/src/lib/client/services/media/stream_orchestrator.svelte.ts` for how to consume the text stream.

## Architecture Directives
- **LPC View Refactor**: Strip the `<style>` block from `lpc_view.svelte`. Replace custom classes (e.g., `.debug-workbench`, `.btn-primary`, `.status-banner`) with standard Tailwind layouts (`grid`, `flex`, `h-screen`) and DaisyUI components.
- **TextGen View Model**: Build `text_view_model.svelte.ts` to manage a local prompt input, an output buffer, and an `AbortController`. It should hit our `/api/text` (or mock) endpoint and accumulate the SSE chunks.
- **Text View Sandbox**: Build a DaisyUI-powered interface (`text_view.svelte`) containing a prompt textarea, a "Generate" button, a "Cancel" button, and a read-only terminal/output window that updates reactively as chunks arrive.

## State & Data Models
The `TextViewModel` state should look conceptually like this:

    {
        prompt: string;
        output: string;
        isGenerating: boolean;
        generate(): Promise<void>;
        cancel(): void;
    }

## Acceptance Criteria

- **AC1: LPC Tailwind Refactor**
  - Given the `lpc_view.svelte` component
  - When inspected
  - Then there are zero `<style>` blocks remaining, and the layout uses Tailwind/DaisyUI (e.g., `flex`, `grid-cols-3`, `btn`, `select`, `range`, `badge`).
  - Test Hook: Manually render the LPC route and ensure the visual layout remains largely identical but driven entirely by utility classes.

- **AC2: TextGen ViewModel Implementation**
  - Given the `TextViewModel`
  - When `generate()` is called
  - Then it successfully opens an SSE connection, appends chunks to the `output` state, and sets `isGenerating` to true until the stream finishes.
  - Test Hook: Unit test the ViewModel against a mocked SSE stream and assert the `output` state accumulates correctly.

- **AC3: TextGen Abort Controller**
  - Given an active generation in the `TextViewModel`
  - When `cancel()` is invoked
  - Then the underlying fetch request is aborted immediately, and `isGenerating` reverts to false.
  - Test Hook: Trigger `generate()`, immediately call `cancel()`, and assert the `AbortSignal` fires.

- **AC4: Text View UI**
  - Given the `/dev/text` route
  - When the user inputs a prompt and clicks Generate
  - Then the DaisyUI interface reactively displays the text streaming in real-time, and disables the Generate button while active.
  - Test Hook: Mount the component in tests, trigger the generate function, and assert the output container contains the rendered text.

## Implementation Notes
1. Start by aggressively deleting the CSS at the bottom of `lpc_view.svelte` and mapping the DOM elements to Tailwind equivalents. `grid-template-columns: 1fr 360px 260px;` becomes `grid grid-cols-[1fr_360px_260px]`, etc.
2. Implement the `text_view_model.svelte.ts`. You can likely repurpose some of the logic from the `StreamOrchestrator` but keep it isolated for this specific dev tool.
3. Build the `text_view.svelte` using DaisyUI cards and inputs. A `<div class="mockup-code">` or simple `bg-base-200` container works well for the streaming output.
4. Ensure no Biome linting errors are introduced during the massive HTML class replacements.

## Edge Cases & Gotchas
- **DaisyUI Ranges**: DaisyUI has a `.range` class that styles `<input type="range">`. Ensure you apply this during the LPC refactor so the sliders don't look broken.
- **Scroll Tracking**: If the text output gets very long in the Text Sandbox, the container should ideally auto-scroll to the bottom.
