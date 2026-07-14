<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-129 Dialogue AI Integration & Polish

## Metadata

| Field | Value |
|---|---|
| **Source** | Active memory — C-128 Dialogue Overlay & AI Chat completion |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/`, `packages/frontend/api-core/src/ai/clients/ollama_client.ts` |
| **Priority** | P1 — Completes the dialogue system MVP |
| **Dependencies** | C-128 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Goal
Finalize the MVP Dialogue system by connecting the Svelte 5 Dialogue Overlay (MVVM) to the local Ollama streaming backend. Ensure seamless text streaming into DaisyUI chat bubbles over the PixiJS canvas, and implement comprehensive Unit, E2E, and Visual testing to validate the overlay mechanics.

## Tech Stack
- **Framework:** Svelte 5 (Runes: `$state`, `$derived`, `$effect`)
- **Architecture:** MVVM (Model-View-ViewModel) isolated from the ECS/Canvas.
- **Testing:** Vitest (Unit), Playwright (Blackbox/E2E), and Custom Visual Sandbox (`apps/e2e/scripts/sandbox_visual.ts`).

---

## Task 1: Refine Ollama Streaming Client
**File:** `packages/frontend/api-core/src/ai/clients/ollama_client.ts`
- Ensure the `OllamaClient` implements `FrontendAiInterface` correctly.
- Implement an async generator function `streamChat(prompt: string, context: any[])` that handles the `application/x-ndjson` streaming response from `http://localhost:11434/api/generate`.
- Ensure error states (e.g., connection refused) throw specific typed errors that the ViewModel can catch.

## Task 2: Create the Dialogue ViewModel
**File:** `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts`
- Create a `DialogueOverlayViewModel` class extending `BaseViewModel`.
- **State (`$state`):**
  - `messages: Array<{ role: 'player' | 'npc', content: string }>`
  - `isStreaming: boolean`
  - `inputText: string`
  - `error: string | null`
- **Actions:**
  - `sendMessage(text: string)`: Appends player message, calls `OllamaClient.streamChat`, and reactively appends chunks to a new NPC message object in the `messages` array.
- Avoid passing raw Svelte state to the ECS or WebGL contexts. Maintain strict isolation.

## Task 3: Build the Svelte 5 Dialogue View
**File:** `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte`
- Import and instantiate `DialogueOverlayViewModel`.
- Use an absolute, full-width/height container with a semi-transparent gradient background (`z-10`, `pointer-events-auto`) to sit on top of the PixiJS canvas.
- Iterate over `viewModel.messages` using `{#each}`. Render them using DaisyUI classes (`chat chat-start` for NPC, `chat chat-end` for Player).
- Bind an `<input type="text">` to `viewModel.inputText` and handle `onkeydown` (Enter) to trigger `sendMessage`.
- Show a loading indicator (e.g., DaisyUI `loading-dots`) when `viewModel.isStreaming` is true and the last message chunk is still arriving.

## Task 4: Unit Testing the ViewModel
**File:** `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts`
- Write Unit tests using Vitest.
- Mock the `OllamaClient` to yield a mock stream of text chunks ("Hello", " World").
- Assert that `viewModel.messages` updates correctly after `sendMessage` is called.
- Assert that `isStreaming` toggles to `true` and then back to `false` when the stream finishes.

## Task 5: E2E and Visual Regression Testing
**File:** `apps/e2e/tests/client/dialogue_visual.spec.ts`
- Create a Playwright test script mimicking the structure of `apps/e2e/scripts/sandbox_visual.ts`.
- **Test 1 (Blackbox Flow):** Navigate to a sandbox route that mounts the dialogue overlay. Type a message, hit enter, and mock the network route (`route.fulfill`) for `localhost:11434` to return a streamed response. Assert the text appears in the DOM.
- **Test 2 (Visual Regression):** Capture a screenshot of the overlay with both player and NPC chat bubbles populated. Compare it against the golden baseline to ensure DaisyUI styling and z-index layering hasn't broken.

## Acceptance Criteria
- [ ] `OllamaClient` successfully streams local chunks.
- [ ] `DialogueOverlayViewModel` uses Svelte 5 runes (`$state`) to track conversation history.
- [ ] `dialogue_overlay.svelte` renders DaisyUI chat bubbles over the game canvas without capturing unintended canvas pointer events.
- [ ] Vitest unit tests for the ViewModel pass.
- [ ] Playwright E2E and visual snapshot tests pass.
