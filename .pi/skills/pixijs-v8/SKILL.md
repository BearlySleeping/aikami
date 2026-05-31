---
name: pixijs-v8
description: >-
  PixiJS v8 rendering engine patterns — Application setup, Container/Sprite/Graphics/Text APIs,
  Asset loading (async), WebGPU/WebGL context, bitECS integration for ECS game architecture,
  and the SvelteKit ↔ game engine architectural boundary.
version: 1.0.0
tags: ["pixijs", "pixijs-v8", "game-engine", "webgl", "webgpu", "rendering", "ecs"]
---

# PixiJS v8 — Game Rendering Engine

PixiJS v8 is the rendering layer — creates a canvas, manages the display tree, and draws sprites/graphics/text. Combined with bitECS for game logic in an ECS architecture.

---

## 1. Application Setup

### 1.1 Basic Initialization (v8 API)

```ts
import { Application } from 'pixi.js';

const app = new Application();

await app.init({
  width: 800,
  height: 600,
  backgroundColor: 0x1a1a2e,
  antialias: true,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  // preferWebGPU: true,  // Opt-in to WebGPU
});

document.body.appendChild(app.canvas);
```

**v8 key changes from v7**:
- `new Application()` + `await app.init({...})` — **two-step async init** (NOT the v7 single-constructor pattern)
- `app.canvas` is the DOM element (was `app.view` in v7)
- `app.screen` and `app.stage` are still available
- `backgroundColor` is a number (hex), not a string

### 1.2 Resize Handling

```ts
const resize = () => {
  app.renderer.resize(window.innerWidth, window.innerHeight);
};
window.addEventListener('resize', resize);
```

### 1.3 WebGPU Opt-in

```ts
await app.init({
  preference: 'webgpu',  // Prefer WebGPU, fallback to WebGL
  // OR: preferWebGPU: true  (shorthand)
});
```

WebGPU offers better performance but limited browser support. Always provide a WebGL fallback.

---

## 2. Display Object Hierarchy

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

### 2.1 Container

Groups display objects. Transformations (position, scale, rotation) apply to children.

```ts
import { Container } from 'pixi.js';

const layer = new Container();
layer.x = 100;
layer.y = 50;
layer.scale.set(1.5);
layer.alpha = 0.8;
layer.visible = true;

// Child management
layer.addChild(sprite);
layer.removeChild(sprite);
layer.removeChildren();
const child = layer.getChildAt(0);
const count = layer.children.length;

// Sorting
layer.sortableChildren = true;
sprite.zIndex = 10;  // Higher zIndex renders on top

app.stage.addChild(layer);
```

### 2.2 Sprite

Renders a texture (from an asset or generated).

```ts
import { Sprite, Texture } from 'pixi.js';

// From loaded texture
const sprite = new Sprite(myTexture);
sprite.x = 400;
sprite.y = 300;
sprite.anchor.set(0.5);       // Center pivot
sprite.scale.set(2);
sprite.rotation = Math.PI / 4; // 45 degrees (radians)
sprite.alpha = 0.8;
sprite.tint = 0xff0000;       // Tint red
sprite.visible = true;

// From Texture (white 1x1 — useful for colored rectangles)
const rect = new Sprite(Texture.WHITE);
rect.width = 100;
rect.height = 50;
rect.tint = 0x00ff00;
```

### 2.3 Graphics

Draw vector shapes — lines, rectangles, circles, polygons.

```ts
import { Graphics } from 'pixi.js';

const g = new Graphics();

// Rectangle
g.rect(0, 0, 100, 50);
g.fill({ color: 0xff0000, alpha: 0.5 });
g.stroke({ color: 0xffffff, width: 2, alpha: 1 });

// Circle
g.circle(50, 50, 30);
g.fill({ color: 0x00ff00 });

// Line
g.moveTo(0, 0);
g.lineTo(100, 100);
g.stroke({ color: 0xffff00, width: 3 });

// Clear and redraw
g.clear();
g.rect(10, 10, 80, 80);
g.fill({ color: 0x3355ff });

// Rounded rectangle
g.roundRect(0, 0, 200, 100, 10);
g.fill({ color: 0x663399 });
```

**v8 change**: `beginFill()` / `endFill()` / `drawRect()` are replaced with chained `.rect().fill()` / `.circle().fill()` API. The v7 imperative methods are deprecated.

### 2.4 Text

```ts
import { Text, TextStyle } from 'pixi.js';

const style = new TextStyle({
  fontFamily: 'Arial',
  fontSize: 24,
  fontWeight: 'bold',
  fill: 0xffffff,          // Text color (hex number)
  stroke: { color: 0x000000, width: 2 },
  align: 'center',
  wordWrap: true,
  wordWrapWidth: 200,
  lineHeight: 32,
});

const text = new Text({
  text: 'Hello PixiJS v8!',
  style,
});
text.x = 400;
text.y = 300;
text.anchor.set(0.5);

// Update text
text.text = 'Updated text';
```

**v8 change**: `new Text('text', style)` → `new Text({ text: 'text', style })`. The v7 constructor signature is deprecated.

### 2.5 AnimatedSprite

```ts
import { AnimatedSprite } from 'pixi.js';

const anim = new AnimatedSprite(textures);  // Texture[]
anim.animationSpeed = 0.1;  // Speed multiplier
anim.loop = true;
anim.play();  // Start animation
anim.stop();  // Stop animation
anim.gotoAndPlay(5);  // Jump to frame 5 and play
```

---

## 3. Asset Loading (v8 Async)

PixiJS v8 uses `Assets` for loading. All loading is async.

```ts
import { Assets } from 'pixi.js';

// Bundle loading (recommended)
Assets.addBundle('game', {
  player: '/assets/player.png',
  enemy: '/assets/enemy.png',
  background: '/assets/bg.jpg',
  spritesheet: '/assets/characters.json',  // JSON spritesheet
});

const assets = await Assets.loadBundle('game');
const playerTexture = assets.player;      // Texture object
const playerSprite = new Sprite(playerTexture);

// Individual loading
const texture = await Assets.load('/assets/player.png');

// Background loading with progress
Assets.add('big-texture', '/assets/large.png');
Assets.backgroundLoad(['big-texture']);  // Start loading in background

const onProgress = (progress: number) => {
  console.log(`Loading: ${Math.round(progress * 100)}%`);
};

const loaded = await Assets.load('big-texture', onProgress);

// Unload to free memory
Assets.unload('/assets/player.png');
Assets.unloadBundle('game');
```

**Types returned**: `Assets.load()` returns `Texture` for images, `Spritesheet` for `.json` spritesheets, `FontFace` for fonts.

### 3.1 Loading Spritesheets

```jsonc
// characters.json
{
  "frames": {
    "walk_01": { "frame": { "x": 0, "y": 0, "w": 64, "h": 64 } },
    "walk_02": { "frame": { "x": 64, "y": 0, "w": 64, "h": 64 } }
  },
  "meta": {
    "image": "characters.png",
    "size": { "w": 128, "h": 64 }
  }
}
```

```ts
const spritesheet = await Assets.load('/assets/characters.json');
const walkTextures = [
  spritesheet.textures['walk_01'],
  spritesheet.textures['walk_02'],
];
const anim = new AnimatedSprite(walkTextures);
```

---

## 4. Game Loop (Ticker)

```ts
import { Ticker } from 'pixi.js';

app.ticker.add((ticker) => {
  // deltaTime in frames (1.0 = 60fps, 2.0 = 30fps)
  const delta = ticker.deltaTime;
  const elapsed = ticker.elapsedMS;  // ms since last frame

  player.x += speed * delta;
});

// Stop/start
app.ticker.stop();
app.ticker.start();

// Custom ticker
const customTicker = new Ticker();
customTicker.maxFPS = 30;
customTicker.add(callback);
customTicker.start();
```

---

## 5. Event System (Federated Events)

```ts
// Make interactive
sprite.eventMode = 'static';   // 'static' | 'passive' | 'none'
sprite.cursor = 'pointer';

sprite.on('pointerdown', (event) => {
  console.log('clicked at', event.globalX, event.globalY);
});

sprite.on('pointerover', () => sprite.tint = 0xff0000);
sprite.on('pointerout', () => sprite.tint = 0xffffff);

// Global events
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;  // Full-screen hit area
app.stage.on('pointermove', (event) => {
  mouseX = event.globalX;
  mouseY = event.globalY;
});

// Keyboard (requires canvas focus or window listener)
window.addEventListener('keydown', (e) => keys[e.key] = true);
window.addEventListener('keyup', (e) => keys[e.key] = false);
```

---

## 6. Filters and Effects

```ts
import { BlurFilter, ColorMatrixFilter } from 'pixi.js';

sprite.filters = [new BlurFilter({ strength: 8 })];

// Grayscale
const grayscale = new ColorMatrixFilter();
grayscale.grayscale(1);
sprite.filters = [grayscale];
```

---

## 7. Integration with bitECS

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

**Key principle**: bitECS owns the data. PixiJS reads it each frame. Never store PixiJS objects inside bitECS arrays — store references instead (or use a Map<int, Sprite>).

---

## 9. SvelteKit ↔ Game Engine Boundary

The game engine (PixiJS v8 + bitECS) runs inside the SvelteKit PWA through a
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

#### 9.1 No `$state` in Game Code

Game code in `apps/frontend/pwa/src/lib/game/` runs at 60fps via
`requestAnimationFrame`. Any `$state` variable touched in the game loop
triggers a full DOM re-render every frame — catastrophic performance impact.
The game directory is a **pure imperative TypeScript zone** with zero Svelte
imports.

```typescript
// ❌ Forbidden — $state in game code
// apps/frontend/pwa/src/lib/game/systems/movement.ts
let playerX = $state(0); // Crashes Svelte microtask queue!

// ✅ Correct — plain variable updated by the ticker
// apps/frontend/pwa/src/lib/game/systems/movement.ts
let playerX = 0;
```

#### 9.2 Svelte UI Handles Low-Frequency State

ViewModels in `apps/frontend/pwa/src/lib/views/` handle UI-relevant state only:

- **Menus** — open/closed, selected item
- **Chat wrappers** — message lists, input text, loading flags
- **Stats blocks** — health bars, inventory counts, character sheets
- **HUD** — minimap toggle, skill cooldowns, quest trackers

These update at human-perceptible rates (seconds, not milliseconds). The bitECS
engine ticker handles per-frame tick metrics (position deltas, collision
results, animation frames) natively via structural array (SoA) configurations
— never through Svelte runes.

#### 9.3 Bridge Serialization

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

#### 9.4 Event Emission at UI-Relevant Intervals

Bridge events must be emitted at UI-relevant intervals — not per-frame:

- ✅ **Dialog triggers** — when player interacts with NPC
- ✅ **Health changes** — when damage taken (not every frame of an animation)
- ✅ **Scene transitions** — when entering/exiting a location
- ❌ **Position updates** — every frame (handle in-game only, smooth via
  PixiJS tweening)
- ❌ **Animation frames** — every frame (handled by PixiJS `AnimatedSprite`)

#### 9.5 No Blocking the Game Loop

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

---

## 10. Gotchas

### 8.1 Async Init
PixiJS v8 `Application.init()` is async. You MUST `await` it. The v7 pattern `new Application({...})` does NOT work in v8.

### 8.2 Constructor API Changes
| v7 | v8 |
|---|---|
| `new Application({...})` | `new Application()` + `await app.init({...})` |
| `app.view` | `app.canvas` |
| `new Text('text', style)` | `new Text({ text: 'text', style })` |
| `g.beginFill(0xff0000).drawRect(0,0,100,50).endFill()` | `g.rect(0,0,100,50).fill({color: 0xff0000})` |
| `new Graphics().beginFill()` | `new Graphics().rect().fill()` |

### 8.3 Asset Loading is Always Async
`Assets.load()` returns a Promise. Trying to use textures synchronously before loading completes will fail. Preload all assets before initializing the game scene.

### 8.4 Memory Management
PixiJS textures consume GPU memory. Call `texture.destroy()` or `Assets.unload()` when textures are no longer needed. Destroy sprites/containers that are removed from the stage.

### 8.5 WebGL Context Loss
On mobile or aggressive tab suspension, WebGL context can be lost. Handle with:
```ts
app.renderer.on('context-restored', () => {
  // Re-upload textures, restart game loop
});
```

### 8.6 Pixel Ratio
Use `resolution: window.devicePixelRatio`, `autoDensity: true` for sharp rendering on HiDPI screens. Without `autoDensity`, CSS size and canvas size diverge.

### 8.7 EventMode
`interactive = true` (v7) is deprecated. Use `eventMode = 'static'` in v8. Without setting `eventMode`, pointer events won't fire.

### 8.8 bitECS Store Pattern
bitECS uses SoA (Structure of Arrays). Store PixiJS display object references in a `Map<number, DisplayObject>`, NOT in typed arrays. Typed arrays only hold numbers.

```ts
// WRONG — PixiJS objects in bitECS arrays
const Sprites = { sprite: [] as Sprite[] };

// RIGHT — separate Map
const spriteMap = new Map<number, Sprite>();
```
