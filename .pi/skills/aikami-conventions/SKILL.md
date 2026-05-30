---
name: aikami-conventions
description: Project-specific conventions for Aikami — Svelte 5 ViewModel pattern, Firebase backend, services architecture, strict TypeScript, path comments. Use when writing or refactoring Aikami code.
version: 1.0.0
tags: ["aikami", "svelte5", "sveltekit", "firebase", "conventions"]
---

# Aikami Conventions

Project-specific patterns for the Aikami monorepo. For universal TypeScript rules (function style, early returns, type system, JSDoc), see the `coding-standards` skill.

## 1. File Path Comments

Every file must include its relative path from the monorepo root as a comment at the very top of the file.

### TypeScript Files (`.ts` / `.svelte.ts`)
The path comment must be placed on **line 1**, at the absolute top of the file before any imports.

```typescript
// apps/frontend/pwa/src/lib/views/app/drawer/notification/NotificationDrawer.svelte.ts
import { BaseViewModel, type BaseViewModelInterface } from "$lib/components/BaseViewModel.svelte";
```

### Svelte Files (`.svelte`)
The path comment must be placed exactly on the **first line inside the `<script>` tag**.

```svelte
<script lang="ts">
  // apps/frontend/pwa/src/lib/views/app/drawer/notification/NotificationDrawer.svelte
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
</script>
```

## 2. TypeScript Strictness

### ❌ Forbidden — Use the alternative

| Forbidden | Use Instead |
|-----------|-------------|
| `any` | `unknown` + type guards |
| `null` | `undefined` everywhere |
| `!` (non-null assertion) | Early returns or optional chaining |
| `as unknown as Type` | Proper data transformation functions |
| `interface` (default) | `type` alias (unless you need `extends` / class impl) |
| Exporting single-use types | Define near/inside the method that uses it |

### ❌ Forbidden patterns
- **Chained arguments** — All methods must use an options object `{...}`, even for single arguments
- **Single-line `if` statements** — Always use curly braces `{}` even for a single statement
- **Abbreviations** — Write out full words (`options` not `opts`, `functionName` not `fnName`)

### ✅ Required patterns
- **Escape Early** — Always use the return-early pattern to avoid deep nesting
- **Arrow Functions** — Default to arrow functions for standard methods and callbacks
- **Extract Logic** — If a section within a method can stand alone, extract it into a separate private method
- **Debug Logging** — All service and view model methods must call `this.debug()` at the start. For standalone functions, import logger from `$logger` and call `logger.debug()`
- **JSDoc Everything** — All methods, properties, and complex types must be thoroughly JSDoc commented
- **Standardized Logging** — Always use the logger from `$logger`. Use `logger.debug` for detailed tracking

## 3. Svelte 5 Core

### Reactivity is Runes ONLY
No `$:` syntax. No stores (`writable`, `readable`).

```typescript
let count = $state(0);                    // State
let doubled = $derived(count * 2);       // Derived
$effect(() => { console.log(count); });   // Side effects
```

### Props
```svelte
let { user, theme = 'dark' } = $props();
let { value = $bindable() } = $props();
```

### Event handlers
Use HTML `onclick`, not Svelte 4 `on:click`:
```svelte
<button onclick={handleClick}>Click</button>
```

### Engine Boundary Constraint

**`$state` runes are banned in game code.** The PixiJS v8 + bitECS game engine runs at 60fps via `requestAnimationFrame` and lives in `apps/frontend/pwa/src/lib/game/`. Any `$state` variable touched in the game loop triggers a full DOM re-render every frame, crashing the microtask queue (`ERR_SVELTE_TOO_MANY_UPDATES`).

- **Svelte UI**: Handles low-frequency state — menus, chat wrappers, stats blocks, inventory. Uses `$state` runes.
- **Game Engine**: Handles high-frequency tick data — movement, rendering, physics. Pure imperative TypeScript. No Svelte imports.
- **Bridge**: All UI↔Game communication goes through the typed `EngineBridge` (`GameCommand` →, `GameEvent` ←). See Section 11.

## 4. ViewModel Pattern

**Views are thin wrappers. ViewModels own all logic.** No local `$state` in views. No `onMount`.

### Architecture rules (from AGENTS.md)
- ❌ **Svelte stores** (`writable`, `readable`) → Use singleton services with `$state`
- ❌ **Local `$state` in views** → All state belongs in the ViewModels
- ❌ **`onMount` for initialization** → Use the `initialize()` method in your ViewModels
- ❌ **Destructuring ViewModels** → Never destructure reactive properties. Always access directly (`viewModel.show`)
- ❌ **`$derived` to proxy external service state** → Always use **native getters**
  - **❌ WRONG:** `confirmDialog = $derived(dialogService.confirmDialog);`
  - **✅ CORRECT:** `get confirmDialog() { return dialogService.confirmDialog; }`

### ViewModel template
```typescript
// apps/frontend/pwa/src/lib/views/feature/feature_view_model.svelte.ts
import { BaseViewModel, type BaseViewModelInterface, type BaseViewModelOptions } from "$lib/components/BaseViewModel.svelte";

export type FeatureViewModelInterface = BaseViewModelInterface & {
  items: string[];
};

export interface FeatureViewModelOptions extends BaseViewModelOptions {}

export class FeatureViewModel
  extends BaseViewModel<FeatureViewModelOptions>
  implements FeatureViewModelInterface
{
  items = $state<string[]>([]);

  async initialize(): Promise<void> {
    this.debug("initialize");
    this.items = ["Item A", "Item B"];
  }
}

export const getFeatureViewModel = (options: FeatureViewModelOptions): FeatureViewModel => {
  return new FeatureViewModel(options);
};
```

### View template
```svelte
<script lang="ts">
  // apps/frontend/pwa/src/lib/views/feature/feature_view.svelte
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
  import type { FeatureViewModelInterface } from './feature_view_model.svelte.ts';

  type Props = { viewModel: FeatureViewModelInterface };
  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#each viewModel.items as item}
    <p>{item}</p>
  {/each}
</BaseViewModelContainer>
```

## 5. Services Architecture

Singleton classes with `$state` for external state management. Never use Svelte stores.

```typescript
// packages/frontend/services/src/lib/my_service.svelte.ts
import { BaseClass, type BaseClassInterface } from "@aikami/utils";

export type MyServiceInterface = BaseClassInterface & {
  items: string[];
  loadItems: () => Promise<void>;
};

export class MyService extends BaseClass implements MyServiceInterface {
  items = $state<string[]>([]);

  async loadItems(): Promise<void> {
    this.debug("loadItems");
  }
}

export const myService = new MyService();
```

Access in ViewModels via native getters (NOT `$derived`).

## 6. Import Aliases

| Alias | Target |
|-------|--------|
| `$lib` | `apps/frontend/pwa/src/lib` |
| `$types` | `@aikami/types` |
| `$services` | Services layer |
| `$logger` | `@aikami/logger` |
| `$views` | `$lib/views` |

## 7. Error Handling

Use `AppError` from `@aikami/utils`:

```typescript
import { toAppError } from "@aikami/utils";

throw toAppError("not-found", "Resource not found");
throw toAppError("invalid-argument", "Invalid email");
throw toAppError("unauthorized", "User not logged in");
```

Valid types: `not-found`, `invalid-argument`, `unauthorized`, `unauthenticated`, `internal`, `captcha-required`.

## 8. Validation

### Server-Side (Zod)

All server-side runtime validation (Firebase Functions, API boundaries) uses Zod from `@aikami/schemas`:

```typescript
import { z } from "zod";
import { userSchema } from "@aikami/schemas";
```

### Client-Side (Valibot)

Client-side perimeter validation uses Valibot for lightweight, tree-shakeable validation (~1.5KB vs Zod's ~12KB):

```typescript
import * as v from 'valibot';
import { userSchema } from '@aikami/valibot-schemas';
```

**Rule**: Zod stays on the server; Valibot is preferred on the client (PWA).

## 9. Project Structure

```
aikami/
  apps/
    frontend/pwa/         — SvelteKit PWA
    │   └── src/lib/game/  — 🎮 PixiJS v8 + bitECS engine (C-016)
    frontend/landing_page/ — Landing page (Astro)
    frontend/docs/         — Documentation site (Astro)
    frontend/gamejs/       — ⚠️ DEPRECATED — Legacy GodotJS client
    │                        Migration target: pwa/src/lib/game/
    backend/functions/     — Firebase Cloud Functions v2
  packages/
    shared/                — constants, logger, mocks, schemas, types, utils, valibot-schemas
    backend/               — ai, auth, configs, database, svelte-kit, utils
    frontend/              — components, configs, repositories, services, utils, tanstack-db
    scripts/               — CI, setup, ops scripts
```

## 10. Moon Commands

Use extension tools: `validate()` for fix+typecheck+build+test, `moon_detect_affected()` before running tests.

```bash
bun moon run pwa:dev              # Start PWA dev server (includes game engine)
bun moon run :typecheck            # Type-check all projects
bun moon run :lint                 # Lint all projects
bun moon run :fix                  # Auto-fix lint issues
bun moon run :test                 # Run all tests
bun moon run :validate             # Full CI validation
```

## 11. Architectural Boundary Pattern

The game engine (PixiJS v8 + bitECS) runs inside the SvelteKit PWA through a strict architectural boundary. This decoupling prevents the 60fps game loop from triggering Svelte 5 reactivity and crashing the browser microtask queue.

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

#### 1. No `$state` in Game Code

Game code in `apps/frontend/pwa/src/lib/game/` runs at 60fps via `requestAnimationFrame`. Any `$state` variable touched in the game loop triggers a full DOM re-render every frame — catastrophic performance impact. The game directory is a **pure imperative TypeScript zone** with zero Svelte imports.

```typescript
// ❌ Forbidden — $state in game code
// apps/frontend/pwa/src/lib/game/systems/movement.ts
let playerX = $state(0);  // Crashes Svelte microtask queue!

// ✅ Correct — plain variable updated by the ticker
// apps/frontend/pwa/src/lib/game/systems/movement.ts
let playerX = 0;
```

#### 2. Svelte UI Handles Low-Frequency State

ViewModels in `apps/frontend/pwa/src/lib/views/` handle UI-relevant state only:

- **Menus** — open/closed, selected item
- **Chat wrappers** — message lists, input text, loading flags
- **Stats blocks** — health bars, inventory counts, character sheets
- **HUD** — minimap toggle, skill cooldowns, quest trackers

These update at human-perceptible rates (seconds, not milliseconds). The bitECS engine ticker handles per-frame tick metrics (position deltas, collision results, animation frames) natively via structural array (SoA) configurations — never through Svelte runes.

#### 3. Bridge Serialization

All payloads crossing the `EngineBridge` must be **plain serializable objects** only:

- ✅ `string`, `number`, `boolean`, arrays of primitives
- ❌ Class instances, functions, PixiJS objects (`Sprite`, `Container`), bitECS handles (`World`, entity references)

```typescript
// ✅ Correct — plain serializable command
type MoveCommand = { type: 'MOVE_PLAYER'; direction: 'up' | 'down' | 'left' | 'right' };

// ✅ Correct — plain serializable event
type DialogEvent = { type: 'DIALOG_TRIGGER'; npcId: string; message: string };

// ❌ Forbidden — PixiJS object crossing the bridge
type BadEvent = { type: 'RENDER'; sprite: Sprite };
```

#### 4. Event Emission at UI-Relevant Intervals

Bridge events must be emitted at UI-relevant intervals — not per-frame:

- ✅ **Dialog triggers** — when player interacts with NPC
- ✅ **Health changes** — when damage taken (not every frame of an animation)
- ✅ **Scene transitions** — when entering/exiting a location
- ❌ **Position updates** — every frame (handle in-game only, smooth via PixiJS tweening)
- ❌ **Animation frames** — every frame (handled by PixiJS `AnimatedSprite`)

#### 5. No Blocking the Game Loop

Bridge message handlers on the Svelte side must not perform synchronous heavy work:

```typescript
// ✅ Correct — offload heavy work
bridge.on('EVENT', (event) => {
  requestIdleCallback(() => {
    processEvent(event);
  });
});

// ❌ Forbidden — synchronous heavy work blocks the game loop
bridge.on('EVENT', (event) => {
  heavySynchronousWork(event);
});
```
