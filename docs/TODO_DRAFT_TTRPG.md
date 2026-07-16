roadmap:

1. **Build a game engine**
2. **Build a persistence layer**
3. **Build an AI orchestration platform**

Trying to solve all three at once is what kills most AI RPG projects.

After looking at the project direction and your comments, I'd actually simplify the priorities quite a bit.

---

# Aikami Roadmap (Critical Draft)

## Vision

Aikami should become an **offline-first AI RPG engine**, not an "AI chat app with memory."

The engine owns the world state.

The LLM only interprets and narrates.

Everything else is deterministic.

---

# Core Principles

## ✅ World state is truth

Never reconstruct the world from chat history.

Everything important exists as structured state.

---

## ✅ AI is stateless

The LLM should never remember anything.

Every response should be generated from

- current scene
- active actors
- recent conversation
- world state

Nothing else.

---

## ✅ Local-first

Turso becomes the default database.

Offline is a feature, not an edge case.

Firebase becomes an optional synchronization layer.

---

# Architecture

```
        UI (Svelte)

             │

      Game Engine (Rust)

             │

        Turso/libSQL
     (primary database)

             │
      Sync Service (optional)

             │

 Firebase (online sync only)
```

Firebase should not be part of the core runtime.

If Firebase disappeared tomorrow, Aikami should still function perfectly.

---

# Why Turso first?

I actually think this is one of the strongest decisions you can make.

Advantages:

- offline campaigns
- instant queries
- simple backups
- portable databases
- easy testing
- no vendor lock-in

It also naturally fits Tauri.

---

# Firebase later

Firebase should solve exactly three problems.

## Device sync

Laptop

↓

Desktop

↓

Tablet

---

## Shared campaigns

Multiple people editing the same campaign.

---

## Cloud backup

Nothing more.

Not game logic.

Not AI orchestration.

Not scene queries.

Not companion logic.

---

# Things I would remove

The previous proposal introduces several systems too early.

## ❌ Firestore as world database

Not needed.

Use Turso.

---

## ❌ Data Connect

Interesting technology.

Wrong problem.

Data Connect shines when you're building dashboards or SaaS applications.

Aikami is effectively a game engine.

SQLite already gives you excellent relational queries locally.

You can always expose cloud analytics later if you need them.

---

## ❌ Event microservices

Too much infrastructure.

An event scheduler inside the engine is enough.

```
Every turn

↓

Advance clocks

↓

Resolve events

↓

Persist state
```

Simple.

---

## ❌ Multiple memory systems

This worries me the most.

VectHare

-

Smart Memory

-

Embeddings

-

Summaries

-

Knowledge graph

-

Firestore

=

too many sources of truth.

You should have exactly one.

---

# Things worth building

## 1. Engine

Highest priority.

- turn processing
- action pipeline
- event queue
- state updates

---

## 2. Database

Turso.

Design this well.

Everything depends on it.

---

## 3. Scene builder

Instead of prompt builders.

Think:

```
Current Scene

Characters

Objects

Weather

Time

Events

Active Quests

Visible NPCs
```

The prompt should simply serialize this.

---

## 4. AI Orchestrator

Instead of

> "write a response"

The orchestrator should execute stages:

```
Player acts

↓

Resolve mechanics

↓

Update world

↓

Advance clocks

↓

Determine active NPCs

↓

Build scene

↓

Narrate
```

That is a genuine game engine pipeline.

---

## 5. Companion autonomy

One of Aikami's differentiators.

Companions should:

- own memories
- own goals
- own relationships
- own knowledge

The DM model should never speak for them.

---

## 6. Structured extraction

Worth building.

Every AI-generated entity should become structured.

```
NPC

Faction

Location

Quest

Rumor

Item

Relationship
```

Never leave important information trapped inside prose.

---

# Things to postpone

These are exciting but not MVP features.

- PixiJS world map
- visual node editor
- analytics
- Data Connect
- graph visualizer
- vector search
- semantic recall
- cloud orchestration

None of these help you finish the engine.

---

# Revised TODO

## Phase 1 — Foundation

- [ ] Define domain model (NPC, Item, Location, Quest, Event, Faction, Character)
- [ ] Design normalized Turso schema
- [ ] Build migration system
- [ ] Implement repository layer
- [ ] Implement save/load
- [ ] Add deterministic IDs
- [ ] Create event queue
- [ ] Create game clock

---

## Phase 2 — Engine

- [ ] Turn processor
- [ ] Action pipeline
- [ ] Rule execution
- [ ] State mutation
- [ ] Event resolution
- [ ] Scheduler
- [ ] Companion decision engine

---

## Phase 3 — AI

- [ ] Scene serializer
- [ ] Prompt builder
- [ ] Structured entity extraction
- [ ] JSON validation
- [ ] Retry/error handling
- [ ] Lore integration

---

## Phase 4 — UX

- [ ] Campaign manager
- [ ] Scene inspector
- [ ] NPC inspector
- [ ] Timeline viewer
- [ ] Event log
- [ ] Save management

---

## Phase 5 — Online Features

- [ ] Firebase authentication
- [ ] Campaign synchronization
- [ ] Conflict resolution
- [ ] Shared campaigns
- [ ] Cloud backups
- [ ] Optional Firebase Data Connect for reporting and administration (only if real use cases emerge)

---

# Long-term Ideas

These are promising but should come only after the core engine is stable:

- VectHare alias resolution
- Embedding-based semantic search
- Automatic relationship graph generation
- World simulation
- Multi-agent NPC planning
- AI-assisted campaign editing

## Overall assessment

The project has a compelling direction because it's aiming to be an **engine**, not just another AI chat frontend. That's a much stronger long-term vision.

The biggest risk isn't the AI models—it's architectural complexity. Every additional database, memory layer, orchestration service, or synchronization mechanism multiplies maintenance cost and makes correctness harder to reason about.

If I had to reduce the entire roadmap to one sentence, it would be:

> **Build a deterministic offline RPG engine on Turso first. Everything cloud-related—including Firebase, Data Connect, analytics, and collaboration—should be layered on afterward as optional capabilities, not dependencies.**
