---
name: pixijs-v8
description: >-
  Aikami-specific PixiJS v8 patterns — bitECS integration for ECS game architecture,
  the SvelteKit ↔ game engine architectural boundary, and project conventions for
  combining PixiJS, bitECS, and Svelte 5 in the Aikami Client. For general PixiJS v8
  API usage (Application, Container, Sprite, Graphics, Text, Assets, Ticker, Events,
  Filters, etc.), see the official skills in .pi/skills-pixijs/.
version: 2.0.0
tags: ["pixijs", "pixijs-v8", "game-engine", "bitECS", "ecs", "sveltekit", "boundary"]
---

# PixiJS v8 — Aikami Integration Patterns

This skill covers **Aikami-specific** PixiJS patterns that combine the PixiJS
rendering engine, bitECS game logic, and SvelteKit UI. For standard PixiJS v8
API reference (Application, Container, Sprite, Graphics, Text, Assets, Ticker,
Events, Filters, etc.), use the official skills installed in
`.pi/skills-pixijs/` — they are loaded alongside this one.

---

## 1. Display Object Hierarchy

The high-level scene graph structure used in the Aikami Client:

```
Application
 └── stage (Container)          ← Root container
      ├── Container (HUD layer)
      ├── Container (game world)
      │    ├── Sprite (player)
      │    ├── Sprite (enemy)
      │    └── Graphics (debug overlay)
      └── Container (UI layer)
```

For Container, Sprite, Graphics, Text, and AnimatedSprite APIs, see:
- `pixijs-scene-container` — grouping, transforms, zIndex, destroy
- `pixijs-scene-sprite` — Sprite, AnimatedSprite, NineSliceSprite, TilingSprite
- `pixijs-scene-graphics` — vector shapes, fill/stroke, GraphicsContext
- `pixijs-scene-text` — Text, BitmapText, HTMLText, TextStyle

---

## 2. Integration with bitECS

PixiJS handles rendering only. bitECS handles game logic. The integration pattern:

```ts
import { createWorld, addEntity, addComponent, defineQuery } from 'bitecs';

// bitECS Components (pure data)
const Position = { x: [] as number[], y: [] as number[] };
const SpriteComponent = { texture: [] as string[], sprite: [] as Sprite[] };

const world = createWorld();

// Query entities with Position + Sprite
const renderableQuery = defineQuery([Position, SpriteComponent]);

// In the PixiJS ticker, sync ECS data → PixiJS display objects
app.ticker.add(() => {
  const entities = renderableQuery(world);
  for (const eid of entities) {
    const sprite = SpriteComponent.sprite[eid];
    sprite.x = Position.x[eid];
    sprite.y = Position.y[eid];
  }
});
```

**Key principle**: bitECS owns the data. PixiJS reads it each frame. Never store PixiJS objects inside bitECS arrays — store references instead (or use a `Map<number, Sprite>`).

### 2.1 bitECS Store Pattern

bitECS uses SoA (Structure of Arrays). Store PixiJS display object references in a `Map<number, DisplayObject>`, NOT in typed arrays. Typed arrays only hold numbers.

```ts
// WRONG — PixiJS objects in bitECS arrays
const Sprites = { sprite: [] as Sprite[] };

// RIGHT — separate Map
const spriteMap = new Map<number, Sprite>();
```

---

## 3. SvelteKit ↔ Game Engine Boundary

The game engine (PixiJS v8 + bitECS) runs inside the SvelteKit Client through a
strict architectural boundary. This decoupling prevents the 60fps game loop
from triggering Svelte 5 reactivity and crashing the browser microtask queue.

### Boundary Diagram

```
┌──────────────────────────────────────────────────────┐
│  SVELTEKIT UI LAYER  ($state runes)                   │
│  ┌───────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ ChatView   │  │ HUDView  │  │ GameViewModel     │ │
│  │ $state()   │  │ $state() │  │ $state(): messages│ │
│  └─────┬──────┘  └────┬─────┘  └────────┬──────────┘ │
│        │              │                  │            │
│        └──────────────┼──────────────────┘            │
│                       │ EngineBridge.send()            │
│           EngineBridge.on() listen for events          │
├───────────────────────┼───────────────────────────────┤
│  ENGINE BRIDGE        │  (typed message channel)       │
│                       │  GameCommand →                 │
│                       │  GameEvent ←                   │
├───────────────────────┼───────────────────────────────┤
│  PIXIJS + bitECS RUNTIME (imperative, no $state)      │
│  ┌────────────────────┴──────────────────────────────┐│
│  │  GameWorld (bitECS world)                          ││
│  │  ┌─────────┐  ┌─────────┐  ┌───────────────────┐ ││
│  │  │ Systems │  │Entities │  │ PixiJS Application │ ││
│  │  │ movement│  │  NPCs   │  │  <canvas> 60fps    │ ││
│  │  │ render  │  │  player │  │  requestAnimation  │ ││
│  │  │ physics │  │  items  │  │  Frame loop        │ ││
│  │  └─────────┘  └─────────┘  └───────────────────┘ ││
│  └───────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

### Critical Rules

#### 3.1 No `$state` in Game Code

Game code in `apps/frontend/client/src/lib/game/` runs at 60fps via
`requestAnimationFrame`. Any `$state` variable touched in the game loop
triggers a full DOM re-render every frame — catastrophic performance impact.
The game directory is a **pure imperative TypeScript zone** with zero Svelte
imports.

```typescript
// ❌ Forbidden — $state in game code
// apps/frontend/client/src/lib/game/systems/movement.ts
let playerX = $state(0); // Crashes Svelte microtask queue!

// ✅ Correct — plain variable updated by the ticker
// apps/frontend/client/src/lib/game/systems/movement.ts
let playerX = 0;
```

#### 3.2 Svelte UI Handles Low-Frequency State

ViewModels in `apps/frontend/client/src/lib/views/` handle UI-relevant state only:

- **Menus** — open/closed, selected item
- **Chat wrappers** — message lists, input text, loading flags
- **Stats blocks** — health bars, inventory counts, character sheets
- **HUD** — minimap toggle, skill cooldowns, quest trackers

These update at human-perceptible rates (seconds, not milliseconds). The bitECS
engine ticker handles per-frame tick metrics (position deltas, collision
results, animation frames) natively via structural array (SoA) configurations
— never through Svelte runes.

#### 3.3 Bridge Serialization

All payloads crossing the `EngineBridge` must be **plain serializable objects**
only:

- ✅ `string`, `number`, `boolean`, arrays of primitives
- ❌ Class instances, functions, PixiJS objects (`Sprite`, `Container`),
  bitECS handles (`World`, entity references)

```typescript
// ✅ Correct — plain serializable command
type MoveCommand = {
  type: "MOVE_PLAYER";
  direction: "up" | "down" | "left" | "right";
};

// ✅ Correct — plain serializable event
type DialogEvent = { type: "DIALOG_TRIGGER"; npcId: string; message: string };

// ❌ Forbidden — PixiJS object crossing the bridge
type BadEvent = { type: "RENDER"; sprite: Sprite };
```

#### 3.4 Event Emission at UI-Relevant Intervals

Bridge events must be emitted at UI-relevant intervals — not per-frame:

- ✅ **Dialog triggers** — when player interacts with NPC
- ✅ **Health changes** — when damage taken (not every frame of an animation)
- ✅ **Scene transitions** — when entering/exiting a location
- ❌ **Position updates** — every frame (handle in-game only, smooth via
  PixiJS tweening)
- ❌ **Animation frames** — every frame (handled by PixiJS `AnimatedSprite`)

#### 3.5 No Blocking the Game Loop

Bridge message handlers on the Svelte side must not perform synchronous heavy
work:

```typescript
// ✅ Correct — offload heavy work
bridge.on("EVENT", (event) => {
  requestIdleCallback(() => {
    processEvent(event);
  });
});

// ❌ Forbidden — synchronous heavy work blocks the game loop
bridge.on("EVENT", (event) => {
  heavySynchronousWork(event);
});
```
