<!-- completed: 2026-06-29 -->
# Contract: C-063 — Hybrid Expression Extraction & Caching

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | C-059, C-062 |
| Status | completed |
| Version | 1.0 |

## Overview
The Text LLM will drive NPC visual expressions by outputting tags like `<emotion:joy>`. To maintain real-time conversation pacing, we are implementing a hybrid asset resolution strategy. The orchestrator will parse these tags invisibly from the SSE stream. It will first attempt to load a pre-generated static asset for that NPC and emotion (fast-path). If the asset does not exist, it will fallback to generating the expression on-the-fly using the ComfyUI Orchestrator.

## Design Reference
- Review `apps/frontend/client/src/lib/client/services/media/stream_orchestrator.svelte.ts` for where the SSE stream is consumed.
- Review existing static assets in `static/` or the asset catalog to see how pre-generated character portraits are structured.

## Architecture Directives
- **System Prompt Injector**: Updates the base LLM prompt to explicitly instruct the model to use `<emotion:value>` tags when their expression changes.
- **Stream Interceptor**: A regex-based buffer mechanism inside the Stream Orchestrator that detects partial tags (like `<emot`), holding them back from the `currentText` state until the tag completes or invalidates, preventing UI flickering.
- **Expression Asset Resolver**: A utility that takes an `npcId` and `emotion`. It checks the local asset catalog/cache for a pre-generated image path (e.g., `/images/npc/{npcId}/{emotion}.webp`).
- **Hybrid Trigger Pipeline**: If the Resolver finds a path, it instantly triggers the `Pixi Texture Injector`. If not, it cancels any active image generation and fires a new request to the ComfyUI REST/WS pipeline.

## State & Data Models
The orchestrator needs to track the active emotion to avoid duplicate network calls.

    {
        currentEmotion: string | null;
        // ... existing props
    }

Regex target for the stream parser: `/<emotion:([a-zA-Z0-9_-]+)>/g`

## Acceptance Criteria

- **AC1: UI Stream Interception (No Flickering)**
  - Given an incoming SSE text chunk containing `<emotion:joy> Hello!`
  - When the stream orchestrator processes it
  - Then the `currentText` state ONLY receives `Hello!` and the raw tag is completely hidden from the dialogue UI and TTS worker.
  - Test Hook: Feed a mocked SSE stream with fragmented tags (chunk 1: `<emot`, chunk 2: `ion:joy> He`, chunk 3: `llo!`) and assert the accumulated Svelte state never exposes the `<` characters.

- **AC2: System Prompt Enforcement**
  - Given an interaction trigger
  - When the payload is constructed for the Text Gateway
  - Then the system prompt includes strict instructions to emit `<emotion:value>` tags using a predefined list of core emotions.
  - Test Hook: Assert the constructed LLM payload contains the new instructional string.

- **AC3: Pre-generated Asset Fast-Path**
  - Given a successfully extracted emotion tag
  - When the `Expression Asset Resolver` verifies a static image exists for this NPC and emotion
  - Then the system instantly loads the static asset and Bypasses the ComfyUI network call entirely.
  - Test Hook: Mock an NPC with a known static asset map, trigger the emotion, and assert the ComfyUI orchestrator is NEVER called.

- **AC4: ComfyUI Dynamic Fallback & Cancellation**
  - Given a successfully extracted emotion tag for an unknown/procedural NPC
  - When the `Expression Asset Resolver` confirms no static asset exists
  - Then the system fires a generation request to the ComfyUI service.
  - Furthermore, if a second tag arrives while generating, the first request is explicitly aborted.
  - Test Hook: Mock an empty asset map, trigger rapid sequential emotions, and assert the ComfyUI `AbortController` fires for the first request before the second is dispatched.

## Implementation Notes
1. Start with the `Stream Interceptor` logic (AC1). You must maintain a tiny string buffer in the orchestrator to detect if an incoming chunk *might* be the start of a tag (`<`), hold it back from the UI, and release it if it turns out to just be normal text.
2. Build the `Expression Asset Resolver`. For now, it can rely on a simple configuration map or predictable folder structure (e.g., checking if `/assets/images/npc/{id}/{emotion}.webp` exists, or using a predefined manifest).
3. Connect the extracted emotion to the Hybrid Trigger Pipeline (AC3, AC4).
4. Update the prompt building utilities to enforce the tags (AC2).

## Edge Cases & Gotchas
- **Chunk Fragmentation**: The LLM will absolutely slice the tag across multiple network chunks (`<emo` ... `tion:sad` ... `>`). Your buffer logic must be flawless.
- **Dangling Open Brackets**: If a character genuinely uses a less-than sign in dialogue (e.g., "3 < 4"), the buffer must timeout or invalidate and flush the character to the UI so text isn't swallowed permanently.
