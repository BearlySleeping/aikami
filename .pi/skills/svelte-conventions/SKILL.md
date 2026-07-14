---
name: svelte-conventions
description: >-
    🔴 LOAD BEFORE writing ANY Svelte/SvelteKit code in the Aikami Client —
    Svelte 5 runes-only rules, banned Svelte 4 legacy, zero-logic Views,
    ViewModel pattern (interface + factory + create()), services architecture
    with $state singletons, $services barrel imports, DevViewModel sandboxes,
    and client import aliases. Load aikami-conventions first for universal rules.
version: 1.1.0
tags: ["aikami", "svelte", "svelte-5", "sveltekit", "runes", "mvvm", "viewmodel", "frontend"]
---

# Aikami Svelte 5 + SvelteKit Conventions

**Prerequisite**: load `aikami-conventions` first (logger, imports, TS
strictness, monorepo boundaries). This skill covers **Pillars 3 & 4** of the
architecture:

| Pillar | Rule                                                                 |
| ------ | -------------------------------------------------------------------- |
| 3      | Views are completely logicless; state and business logic live in     |
|        | `_view_model.svelte.ts`                                              |
| 4      | `routes/(dev)/` sandboxes use the `DevViewModel` override pattern —  |
|        | extend the production VM, override fetch methods with mock data      |

---

## Svelte 5 Core: Runes ONLY

No `$:` syntax. No stores (`writable`, `readable`).

```typescript
let count = $state(0);              // State
let doubled = $derived(count * 2);  // Derived
$effect(() => { console.log(count); }); // Side effects
```

Props:

```svelte
let { user, theme = 'dark' } = $props();
let { value = $bindable() } = $props();
```

Event handlers use HTML `onclick`, not Svelte 4 `on:click`. When calling a
ViewModel method, **always wrap in an arrow function** — never pass the method
reference:

```svelte
<!-- ✅ CORRECT — arrow wrapper preserves `this`/`super` binding -->
<button onclick={() => viewModel.openUploadInfo()}>Open</button>

<!-- ❌ WRONG — unbound method reference detaches `this` from the instance -->
<button onclick={viewModel.openUploadInfo}>Open</button>
```

**Why**: ViewModel/service methods are regular class methods (not arrow
fields) so `this` and `super` work. Passing `viewModel.method` as a handler
loses the receiver — `this` is `undefined` at call time and `create()`
auto-logging is bypassed.

**Banned Svelte 4 legacy (compilation constraints):**

- ❌ `svelte/store` imports — no `writable`, `readable`, `derived`, `get`
- ❌ `$:` reactive statements and `$:` side-effect blocks
- ❌ `export let` for props — use `$props()`
- ❌ `on:click` / `on:keydown` / `on:submit` event directives
- ❌ `createEventDispatcher` — use callback props instead
- ❌ `<slot>` / `<slot name="...">` — use `{@render children?.()}` and named
  snippet props. `{@render}` works ONLY with snippets defined via
  `{#snippet}` — for reusable components, use `<ComponentName />` import syntax

Use `$derived.by()` for multi-statement derivations. In ViewModels prefer
native getters over `$derived` for computed properties.

Always use `<script lang="ts">`. All `.svelte.ts` files (ViewModels) are
first-class TypeScript modules with Svelte 5 rune support.

---

## Import Services from `$services` Barrel, Never Direct Paths

```typescript
// ✅ CORRECT — import from $services barrel
import { vendorService, audioService, gameStateService } from '$services';

// ❌ WRONG — never import from $lib/services/... directly
import { vendorService } from '$lib/services/game/vendor_service.svelte';
```

**Why**: The barrel (`$services/index.ts`) is the single entry point. Direct
imports bypass re-exports, cause duplicate module instances, and create
circular dependency risks when the imported module itself imports from
`$services`.

### 🔴 Dynamic Imports in the Client: Concrete Rules

The universal rule is in `aikami-conventions` § Dynamic Imports. This section
gives the **client-specific** list — what every frontend agent must follow.

#### ❌ NEVER dynamic-import these in the client:

| Pattern | Examples converted in this codebase |
|---|---|
| **Service → service** | `game_composition_root` → `game_engine_service`, `autonomous_message_service` → `textGenerationService`, `agent_pipeline_service` → `agentRegistryService` |
| **ViewModel → service** | `persona_list_view_model` → `personaService`, `game_view_model` → `getGameCompositionRoot`, `combat_view_model` → `audioService` |
| **Service → $services barrel** | `session_service` → `playerStateService` (from `$services`), `game_ui_view_model` → `gameEngineService` |
| **"Performance phasing"** | `game_composition_root` had 9 `await import()` calls for phased init — all converted to static |

All of these are pure singletons with **no import-time side effects**. Static
imports are faster, simpler, and eliminate unnecessary async cascading.

#### ✅ These MUST stay dynamic in the client:

| Pattern | Why dynamic |
|---|---|
| **Firebase config modules** | Have import-time side effects (`getAnalytics(app)`, `getAuth(app)`, etc.). Analytics crashes in emulator without `appId`. Offline-first — Firebase only activates when needed. |
| **`@aikami/frontend/engine`** | Heavy PixiJS bundle. Deferred until game engine initializes. |
| **AI client factory** | Only the chosen provider's SDK loads (`openai` vs `ollama` vs `gemini`). |
| **Massive libs** | `onnxruntime-web` (~10MB), `kokoro-js`, `pixi.js` Assets module |
| **Tauri APIs** | `@tauri-apps/api/window`, `@tauri-apps/plugin-opener` — not available in browser |
| **Web Workers** | `?worker&type=module` — Vite requires dynamic import syntax |
| **Dev-only tools** | `eruda` — must not ship to production |
| **Platform-specific storage** | `IndexedDB` vs `localStorage` — runtime detection |

---

## ViewModel Pattern

**Views have zero logic** — they are pure HTML/Svelte wrappers. No conditionals,
no data transformation, no `onMount`. Every expression in the view template
must be a direct property access on the ViewModel.

**ViewModels are thin bridges to services** — orchestrate service calls, expose
state to the view, but never contain heavy business logic, import repositories,
or call API/firebase functions directly. That belongs in services.

### 🔴 CRITICAL: View Structural Constraints

- ❌ **Zero script imports** from services, network clients, repositories
- ❌ **No local `$state`** — all state belongs in the ViewModel
- ❌ **No `$derived`** — computed values belong in the ViewModel as getters
- ❌ **No `onMount`** — initialization goes in `ViewModel.initialize()`
- ❌ **No inline event logic** — handlers delegate to ViewModel methods via
  arrow wrappers: `onclick={() => viewModel.method()}`
- ❌ **No destructuring** the `viewModel` prop
- ❌ **No inline expressions** — no ternaries, `.find()`, `.filter()`,
  `.map()`, format calls, or template strings in the markup. Permitted
  expressions: `{viewModel.property}`, `{viewModel.method()}`, and
  arrow-wrapped event handlers `onclick={() => viewModel.method()}` ONLY.

```svelte
<!-- ✅ CORRECT — direct property access -->
<span>{viewModel.formattedParams.temperature}</span>

<!-- ❌ WRONG — inline transformation/logic in view -->
<span>{viewModel.params.temperature.toFixed(2)}</span>
<span>{providers.find(p => p.id === id)?.label}</span>
```

### Export ViewModels via Factory Function, Never Raw Class

```typescript
// ✅ CORRECT — factory with create() returns interface
class MyViewModel extends BaseViewModel<MyOptions> implements MyViewModelInterface {
  // ...
}

export const getMyViewModel = (options: MyOptions): MyViewModelInterface =>
  MyViewModel.create(options);

// ❌ WRONG — never export class directly, never use `new`
export class MyViewModel { ... }
const vm = new MyViewModel(options);
```

**Why**: `BaseViewModel.create()` instruments the instance so every public
method call is auto-logged (prototype method shadowing — not an ES6 Proxy,
which crashes Svelte 5 `$state`). Raw `new` bypasses this instrumentation —
no logging, no diagnostics. The factory returns the Interface type so
consumers depend on the contract, not the implementation.

### 🔴 Interface Methods: Method Signatures, NOT Arrow Properties

Methods in `*Interface` types (ViewModels AND services) are declared with
**method shorthand syntax** — never as arrow-function properties:

```typescript
// ✅ CORRECT — method signatures
export type UploadViewModelInterface = BaseViewModelInterface & {
  readonly isUploadInfoOpen: boolean;
  openUploadInfo(): void;
  closeUploadInfo(): void;
  submit(): Promise<void>;
};

// ❌ WRONG — arrow-function property signatures
export type UploadViewModelInterface = BaseViewModelInterface & {
  openUploadInfo: () => void;
  closeUploadInfo: () => void;
};
```

Implementations use **regular class methods** (`openUploadInfo(): void {}`),
never arrow-function fields (`openUploadInfo = (): void => {}`). Regular
methods keep `this`/`super` working and live on the prototype, which is what
`create()` walks to enable auto-logging. Arrow fields bypass both.

### 🔴 Logging: `this.debug()` etc., NEVER `$logger` in Classes

ViewModels and services extend `BaseViewModel`/`BaseClass`, which provide
`this.debug()`, `this.info()`, `this.warn()`, `this.error()`, `this.log()` —
prefixed with the class name and integrated with `create()` auto-logging.

```typescript
// ✅ CORRECT — inherited logging methods
class UploadViewModel extends BaseViewModel<UploadViewModelOptions> {
  async submit(): Promise<void> {
    // create() already auto-logged the call — only add contextual logs
    this.debug('submit:validated', { fileCount: this.files.length });
    this.error('submit:failed', error);
  }
}

// ❌ WRONG — importing $logger inside a ViewModel or service class
import { logger } from '$logger';
class UploadViewModel extends BaseViewModel<UploadViewModelOptions> {
  async submit(): Promise<void> {
    logger.debug('submit'); // loses className prefix, breaks convention
  }
}
```

`$logger` is reserved for module-level code (standalone arrow functions,
utils) that has no `BaseClass` to inherit from.

### ViewModel Template

```typescript
// apps/frontend/client/src/lib/views/feature/feature_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from "@aikami/frontend/services";
import { myService } from "$services";

export type FeatureViewModelInterface = BaseViewModelInterface & {
  readonly items: string[];
  refresh(): Promise<void>;
};

export type FeatureViewModelOptions = BaseViewModelOptions & {};

export class FeatureViewModel
  extends BaseViewModel<FeatureViewModelOptions>
  implements FeatureViewModelInterface
{
  items = $state<string[]>([]);

  async initialize(): Promise<void> {
    this.items = myService.getItems();
    await super.initialize();
  }

  async refresh(): Promise<void> {
    // create() auto-logs the call — no this.debug() needed at entry
    this.items = myService.getItems();
  }
}

export const getFeatureViewModel = (
  options: FeatureViewModelOptions,
): FeatureViewModelInterface => FeatureViewModel.create(options);
```

### ViewModel Rules

- Export `type ...Interface` with **all data properties `readonly`** and
  **methods as method signatures** (`method(): void`, not `method: () => void`)
- Export `type ...Options` alongside the class
- Export a `getFeatureViewModel` factory function using `ClassName.create()` — **never `new ClassName()`**
- Always extend `BaseViewModel` and `implements *Interface`
- ViewModel files: `{name}_view_model.svelte.ts` (NOT `vm` shorthand)
- Call `super.initialize()` **at the end** of `initialize()`
- Use `registerEffectRoot()` for reactive side effects (NEVER raw `$effect` in views)
- Views access data only through the ViewModel; event handlers use arrow
  wrappers (`onclick={() => viewModel.method()}`)
- Class methods are regular methods, never arrow-function fields — `this` and
  `super` must work
- Logging via inherited `this.debug()` / `this.error()` etc. — never `$logger`
- ViewModel `$state` fields are public by design — do NOT prefix them with `_`
  (exception to the universal private-member `_` rule)
- **Sub-view components** should accept optional `viewModel` via `$props()` with a default factory — never create ViewModels in the parent's `<script>` block and pass them down

### Optional ViewModel Prop Pattern

Sub-view components (reusable UI panels, editor modals) should self-instantiate
their ViewModel via default `$props()`:

```svelte
<!-- ✅ CORRECT — optional viewModel with default factory -->
<script lang="ts">
  import { getMyViewModel, type MyViewModelInterface } from './my_view_model.svelte';

  type Props = {
    viewModel?: MyViewModelInterface;
  };

  const {
    viewModel = getMyViewModel({ className: 'MyViewModel' }),
  }: Props = $props();
</script>

<!-- ❌ WRONG — creating ViewModel in parent's <script> -->
<script lang="ts">
  // parent_view.svelte
  const childVm = getChildViewModel({ ... });
</script>
<ChildView viewModel={childVm} />
```

---

## Services Architecture

Singleton classes with `$state` for external state management. Never use
Svelte stores.

```typescript
// packages/frontend/services/src/lib/my_service.svelte.ts
import { BaseClass, type BaseClassInterface } from "@aikami/utils";

export type MyServiceInterface = BaseClassInterface & {
  readonly items: string[];
  loadItems(): Promise<void>;
};

export class MyService extends BaseClass implements MyServiceInterface {
  items = $state<string[]>([]);

  async loadItems(): Promise<void> {
    // create() auto-logs the call; use this.debug() only for contextual logs
  }
}

// 🔴 Always ClassName.create() — never `new` (enables auto-logging)
export const myService: MyServiceInterface = MyService.create({
  className: "MyService",
});
```

### Native Getters Over `$derived`

```typescript
// ❌ WRONG — $derived on self-referential field
isLoggedIn = $derived(!!this.currentUser);

// ✅ CORRECT — native getter
get isLoggedIn(): boolean { return !!this.currentUser; }
```

Exception: heavy computations (translation, mapping) stay in `$derived(...)`.

### UI State Flags — Where They Live

Visibility booleans, active modals, selected tab index, loading/error/submit
flags, and form field values belong in
`apps/frontend/client/src/lib/views/*_view_model.svelte.ts`. Domain data goes
in services; computed values used by 2+ views go in services; persisted
application state goes in services or shared constants. Labels/translations
belong in `packages/shared/constants/` — never hardcoded in ViewModels.

---

## Import Aliases (client only)

| Alias       | Resolves to                                                       |
| ----------- | ----------------------------------------------------------------- |
| `$lib`      | `apps/frontend/client/src/lib`                                    |
| `$types`    | `apps/frontend/client/src/lib/types` (app-local types)            |
| `$services` | `apps/frontend/client/src/lib/services` (import barrel root)      |
| `$logger`   | Environment-specific logger                                       |
| `$views`    | `$lib/views`                                                      |

`$services` is a barrel, never a directory — always import from root.

---

## Related Skills

| Skill         | Covers                                                    |
| ------------- | --------------------------------------------------------- |
| `svelte-page` | Scaffolding a new page (View + ViewModel files)           |
| `aikami-ui`   | DaisyUI primitives vs components, typography, colors      |
| `pixijs-v8`   | Game engine boundary — no `$state` in game code, bridge   |
