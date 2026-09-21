# NPC Interaction & Dialogue — Gotchas & Lessons Learned

## Rendered Dialogue Overlay Not Appearing

**Problem**: The dialogue overlay didn't render even though `$state` fields were correctly set.

**Root cause**: Svelte 5 `$effect` and `$derived` patterns for tracking `$state` fields on a ViewModel instance received via props are unreliable when the state mutations occur in non-Svelte callbacks (e.g., bridge event handlers).

**Fix**: The **ViewModel owns the lifecycle** — create/destroy sub-ViewModels directly in the bridge handler, store them as `$state` fields, and read them directly in the template via `{#if viewModel.subVm}`.

```svelte
<!-- ✅ Works: read ViewModel field directly -->
{#if viewModel.dialogueViewModel}
  <DialogueOverlay viewModel={viewModel.dialogueViewModel} />
{/if}

<!-- ❌ May not work: intermediate $state/$derived -->
let vm = $state(viewModel.dialogueViewModel); // or $derived
```

## Keyboard Events Not Reaching Engine Handlers

**Problem**: `window.addEventListener('keydown', ...)` wasn't receiving any events.

**Root cause**: The headless browser used for testing can't dispatch keyboard events. In production, other event handlers (`<svelte:window>`, capture-phase listeners) don't interfere — just ensure focus is on the right element.

## E Key Blocked During Chat

**Problem**: Can't type 'E' in chat input because the engine's key handler calls `preventDefault()`.

**Fix**: Gate interaction key handling behind `!this._inputLocked`:
```ts
if ((key === 'e' || key === 'enter') && !this._inputLocked) {
```

## Map-Spawned NPCs Don't Work with _handleInteractKey

**Problem**: NPCs spawned via tilemap `LOAD_MAP` handler don't appear in `_npcMeta`.

**Root cause**: The worker's `LOAD_MAP` handler sends bare `ENTITY_CREATED` messages without `npcData`. The main-thread `_handleEntityCreated` only populates `_npcMeta` when `npcData` is present.

**Fix**: In the worker's `LOAD_MAP` handler, read the `NPCDialog` component after spawning and include `npcData` in the `ENTITY_CREATED` postMessage.

## DialogueOverlayViewModel Without BaseViewModelContainer

**Problem**: `initialize()` is never called because the component isn't wrapped in `BaseViewModelContainer`.

**Fix**: Move initialization that MUST happen (like showing the initial greeting) to the constructor. Keep `initialize()` for optional/TTS setup that can wait.

## OpenRouter vs Ollama Provider Detection

**Problem**: `GameUIView` unconditionally created `OllamaClient`, forcing direct Ollama streaming even when OpenRouter was configured.

**Fix**: Check `aiSettingsService.textProvider.endpoint` — if it contains `localhost`, Ollama is active. Otherwise, don't pass `ollamaClient` to the Dialogue VM, which falls through to `textGenerationService` (OpenRouter).

## Stream-Aware Message Display

**Problem**: Streaming AI response showed two bubbles — an empty placeholder and a separate "..." indicator.

**Fix**: Merge the dots into the placeholder bubble when content is empty:
```svelte
{#if message.content}
  {message.content}
{:else if viewModel.isStreaming}
  <span class="loading loading-dots loading-xs"></span>
{/if}
```

## Proximity Auto-Trigger vs Manual Interact

**Behavior**: The worker's `dialog_trigger_system.ts` emits `NPC_DIALOG_START` when the player enters range. This should NOT auto-open dialogue — only show a proximity hint.

**Current architecture**: `NPC_DIALOG_START` is handled by `GameUIViewModel` as a no-op. Only `NPC_INTERACTED` (emitted on manual E/Enter press via `_handleInteractKey`) opens the dialogue overlay.
