---
name: svelte-conventions
description: >-
    🔴 LOAD BEFORE writing ANY Svelte/SvelteKit code in the Aikami Client —
    Svelte 5 runes-only rules, banned Svelte 4 legacy, zero-logic Views,
    ViewModel pattern (interface + factory + create()), services architecture
    with $state singletons, $services barrel imports, DevViewModel sandboxes,
    and client import aliases. Load aikami-conventions first for universal rules.
version: 1.0.0
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

Event handlers use HTML `onclick`, not Svelte 4 `on:click`:

```svelte
<button onclick={handleClick}>Click</button>
```

**Banned Svelte 4 legacy (compilation constraints):**

- ❌ `svelte/store` imports — no `writable`, `readable`, `derived`, `get`
- ❌ `$:` reactive statements and `$:` side-effect blocks
- ❌ `export let` for props — use `$props()`
- ❌ `on:click` / `on:keydown` / `on:submit` event directives
- ❌ `createEventDispatcher` — use callback props instead
- ❌ `<slot>` / `<slot name="...">` — use `{@render children?.()}` and named
  snippet props

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
- ❌ **No inline event logic** — handlers delegate to ViewModel methods
- ❌ **No destructuring** the `viewModel` prop
- ❌ **No inline expressions** — no ternaries, `.find()`, `.filter()`,
  `.map()`, format calls, or template strings in the markup. Permitted
  expressions: `{viewModel.property}` or `{viewModel.method()}` ONLY.

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

**Why**: `BaseViewModel.create()` wraps the instance in a proxy that auto-logs
every public method call. Raw `new` bypasses this proxy — no logging, no
diagnostics. The factory returns the Interface type so consumers depend on the
contract, not the implementation.

### ViewModel Template

```typescript
// apps/frontend/client/src/lib/views/feature/feature_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from "$lib/components/BaseViewModel.svelte";
import { myService } from "$services/my_service";

export type FeatureViewModelInterface = BaseViewModelInterface & {
  readonly items: string[];
};

export type FeatureViewModelOptions = BaseViewModelOptions & {};

export class FeatureViewModel
  extends BaseViewModel<FeatureViewModelOptions>
  implements FeatureViewModelInterface
{
  items = $state<string[]>([]);

  async initialize(): Promise<void> {
    this.debug("initialize");
    this.items = myService.getItems();
  }
}

export const getFeatureViewModel = (
  options: FeatureViewModelOptions,
): FeatureViewModelInterface => FeatureViewModel.create(options);
```

### ViewModel Rules

- Export `type ...Interface` with **all properties `readonly`**
- Export `type ...Options` alongside the class
- Export a `getFeatureViewModel` factory function using `ClassName.create()` — **never `new ClassName()`**
- Always extend `BaseViewModel` and `implements *Interface`
- ViewModel files: `{name}_view_model.svelte.ts` (NOT `vm` shorthand)
- Call `super.initialize()` **at the end** of `initialize()`
- Use `registerEffectRoot()` for reactive side effects (NEVER raw `$effect` in views)
- Views access data only through the ViewModel
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
  loadItems: () => Promise<void>;
};

export class MyService extends BaseClass implements MyServiceInterface {
  items = $state<string[]>([]);

  async loadItems(): Promise<void> {
    this.debug("loadItems");
  }
}

export const myService: MyServiceInterface = new MyService({
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
| `$services` | `apps/frontend/client/src/lib/client/services/index.ts` (barrel)  |
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
