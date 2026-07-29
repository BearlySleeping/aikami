# Design Rationale

> Architectural principles from the TTRPG design phase.

## Design Rationale (from former TODO_DRAFT_TTRPG.md)

> Preserved as architectural reference. These principles informed the completed
> contracts and continue to guide the remaining backlog.

**Core Principles:**

- **World state is truth.** Never reconstruct the world from chat history.
  Everything important exists as structured state.
- **AI is stateless.** The LLM should never remember anything. Every response
  should be generated from current scene, active actors, recent conversation,
  and world state — nothing else.
- **Local-first.** Turso is the default database. Offline is a feature, not an
  edge case. Firebase is an optional synchronization layer.

**Architecture:**

```
        UI (Svelte)
             │
      Game Engine (bitECS)
             │
        Turso/libSQL
     (primary database)
             │
      Sync Service (optional)
             │
 Firebase (auth/backup/sync only)
```

**Things worth building:**

1. Engine — turn processing, action pipeline, event queue, state updates
2. Database — Turso, designed well, everything depends on it
3. Scene builder — serialize current scene (characters, objects, weather, time,
   events, active quests, visible NPCs) into the prompt
4. AI Orchestrator — staged pipeline: player acts → resolve mechanics → update
   world → advance clocks → determine active NPCs → build scene → narrate
5. Companion autonomy — companions own their memories, goals, relationships,
   and knowledge; the DM model never speaks for them
6. Structured extraction — every AI-generated entity becomes structured (NPC,
   Faction, Location, Quest, Rumor, Item, Relationship); never leave important
   information trapped inside prose

**Things explicitly avoided:**

- Multiple memory systems (VectHare, Smart-Memory, embeddings, summaries,
  knowledge graph, Firestore) — exactly one memory system (C-350)
- Firestore as world database — use Turso
- Data Connect as the NPC/chat/items store — Turso is campaign-runtime truth
- Event microservices — an event scheduler inside the engine is sufficient
- AI computing HP/durability/economy math — deterministic rules kernel (C-336)
  owns all mechanical state; AI only narrates

---
