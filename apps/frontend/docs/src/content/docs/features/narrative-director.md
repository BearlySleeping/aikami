---
title: Narrative Director
description: Background AI-driven narrative generation that references campaign history for richer, more contextual scene direction.
---

The Narrative Director runs as a background LLM agent that generates scene
direction at configurable intervals (default 120 seconds). It proposes story
beats and atmospheric descriptions that build on your campaign's history,
referencing past events, relationships, and lore retrieved from the in-memory
retrieval system.

The director is **advisory only** — it proposes narrative beats that the
rules engine and GM prompt system can draw from, but never directly mutates
game state.

## How It Works

The director's generation cycle works in three phases:

1. **Memory retrieval**: before generating a scene direction, the director
   queries the memory/lore retrieval system (C-458) for content relevant to
   the current arc. Query text is formed from the arc description and the
   last scene direction (if any).

2. **LLM generation**: a low-temperature text generation call produces a
   structured `SceneDirection` object with a scene description and optional
   player guidance.

3. **Prompt injection**: the generated direction (including any retrieved
   memory) is made available as a `[NARRATIVE GUIDANCE]` section in the GM
   system prompt assembly (`gm_prompt_service.svelte.ts`). This section is
   included at **medium priority** — present when the budget allows, dropped
   before low-priority sections if the prompt exceeds the 6 KB cap.

## Graceful Degradation

The director degrades gracefully when retrieval is unavailable:

- **Fresh campaigns** with no indexed history: scene direction uses
  world/party/quest state only (the existing C-235 behavior).
- **Retrieval disabled**: respects the C-458 memory retrieval toggle.
- **Retrieval errors**: a failed query does not block generation — the
  director falls back to world-state-only output.

## Key Files

| File | Purpose |
|---|---|
| `src/lib/services/gm/narrative_director_service.svelte.ts` | Background generation loop with memory retrieval integration |
| `src/lib/services/gm/gm_prompt_service.svelte.ts` | Prompt assembler with `[NARRATIVE GUIDANCE]` section |
| `src/lib/services/gm/gm_types.ts` | `SceneDirection` type with optional `referencedMemory` field |
| `src/lib/services/memory/memory_retrieval_service.svelte.ts` | Memory retrieval system (C-458) |
