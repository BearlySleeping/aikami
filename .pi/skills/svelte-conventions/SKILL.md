---
name: svelte-conventions
description: >-
  Svelte 5 + SvelteKit conventions for Aikami — runes-only reactivity,
  ViewModel pattern, singleton services with $state, import aliases.
  Use when writing SvelteKit pages, views, ViewModels, or services.
  Builds on `aikami-conventions` (foundational skill — loaded first).
version: 3.0.0
tags: ["svelte5", "sveltekit", "viewmodel", "frontend", "phase-2", "mvvm", "dev-sandbox"]
---

# Svelte Conventions

Svelte 5 + SvelteKit patterns for the Aikami PWA.
`aikami-conventions` is the foundational skill — it covers arrow functions,
type rules, import paths, error handling, logging (`$logger`), and file
naming.

---

## 🔴 PHASE 2 PILLARS — MVVM + DEV SANDBOXES

These two pillars are non-negotiable for all Svelte 5 code in the PWA.
They build on the ViewModel pattern described in §2 below — that section
contains the full reference; this section is the **enforcement mandate**.

### Pillar 3: Logicless Views + Service-Only ViewModels

Two halves of the same rule, both absolute:

**A) `.svelte` view files — ZERO logic, ZERO methods.** Views are pure DOM
markup. They contain no `$state`, no `$derived`, no `$effect`, no `onMount`,
no `onDestroy`, no local functions or methods, no inline conditionals or
transforms. Every expression in the template is a direct property access or
method call on the ViewModel — nothing else.

```svelte
<!-- ✅ CORRECT — completely dumb view, zero logic -->
<script lang="ts">
  // apps/frontend/pwa/src/lib/views/chat/chat_view.svelte
  import type { ChatViewModelInterface } from './chat_view_model.svelte.ts';
  type Props = { viewModel: ChatViewModelInterface };
  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <p>{viewModel.greeting}</p>
  {#each viewModel.messages as message}
    <p>{message.text}</p>
  {/each}
  <button onclick={() => viewModel.send()}>Send</button>
</BaseViewModelContainer>

<!-- ❌ WRONG — logic leaking into the view -->
<script lang="ts">
  const count = $state(0);              // ❌ no local state in views
  const doubled = $derived(count * 2);  // ❌ no derived in views
  $effect(() => {                       // ❌ no effects in views
    document.title = `${count} messages`;
  });

  const formatDate = (ts: number) => {  // ❌ NO methods in views
    return new Date(ts).toLocaleString();
  };

  import { messageService } from '$services'; // ❌ no imports from services
</script>

{#if messages.filter(m => m.unread).length > 0}  <!-- ❌ logic in template -->
  <p>You have {messages.filter(m => m.unread).length} unread</p>
{/if}
```

**Enforcement checklist — every `.svelte` view must pass ALL:**

- [ ] No `$state` rune — only in `_view_model.svelte.ts` files
- [ ] No `$derived` rune — use native getters on the ViewModel
- [ ] No `$effect` rune — use ViewModel `initialize()` for side effects
- [ ] No `onMount` / `onDestroy` — lifecycle belongs in ViewModel
- [ ] No local functions or methods — everything is a ViewModel method call
- [ ] No `{#if}` or `{#each}` with inline expressions — all data is
      pre-computed by the ViewModel and exposed as ready-to-render values
- [ ] No `import` of services, repositories, Firebase SDK, constants,
      or data files — only import the ViewModel interface type
- [ ] All `onclick` / `onchange` / `oninput` handlers delegate to ViewModel
      methods without inline logic (e.g., `() => viewModel.send()`, not
      `(e) => { e.preventDefault(); viewModel.send(); ... }`)

**B) `_view_model.svelte.ts` files — services only, NO direct I/O or heavy
logic.** ViewModels orchestrate services; they never call `fetch`, Firebase
SDKs, database operations, `AudioContext`, `localStorage`, `IndexedDB`,
or any browser API. They never contain heavy business logic, data
normalization pipelines, or complex algorithms. That belongs in services
(§3 below).

```typescript
// ❌ WRONG — ViewModel calling fetch directly
class ChatViewModel extends BaseViewModel {
  async loadMessages(): Promise<void> {
    const response = await fetch('/api/messages');  // ❌ NO fetch in VM
    this.messages = await response.json();
  }
}

// ❌ WRONG — ViewModel importing Firebase SDK
import { doc, getDoc } from 'firebase/firestore';
class ChatViewModel extends BaseViewModel {
  async loadUser(userId: string): Promise<void> {
    const snap = await getDoc(doc(db, 'users', userId)); // ❌ NO Firebase in VM
  }
}

// ✅ CORRECT — ViewModel delegates to service
import { chatService } from '$services';
class ChatViewModel extends BaseViewModel {
  async loadMessages(): Promise<void> {
    await chatService.loadMessages();  // ✅ service handles all I/O
    this.messages = chatService.messages;
  }
}
```

**ViewModel enforcement checklist:**

- [ ] No `fetch()` calls — delegate to services
- [ ] No Firebase SDK imports (`firebase/firestore`, `firebase/auth`, etc.)
- [ ] No browser API calls (`AudioContext`, `localStorage`, `URL.createObjectURL`,
      `IndexedDB`, `navigator.*`, `Worker`, etc.)
- [ ] No heavy business logic, complex algorithms, or data normalization —
      extract to services
- [ ] No direct repository or database imports — services own data access
- [ ] Service singletons referenced directly (`chatService.send()`), never
      stored as `this._service`

### Pillar 4: Dev Sandbox Override Pattern

Routes under `(dev)/` are isolated frontend sandboxes. They must **never**
call real backends, Firebase, or external microservices. Use the
`DevViewModel` override pattern to inject mock data.

**File structure:**

```
apps/frontend/pwa/src/lib/views/
├── chat/
│   ├── chat_view_model.svelte.ts       ← Production ViewModel
│   └── chat_view.svelte                ← Production view
└── (dev)/
    └── chat/
        ├── chat_dev_view_model.svelte.ts  ← Dev override (extends production)
        └── chat_dev_view.svelte           ← Dev view (or reuse production view)
```

**DevViewModel — extends production, overrides only I/O methods:**

```typescript
// apps/frontend/pwa/src/lib/views/(dev)/chat/chat_dev_view_model.svelte.ts
import {
  ChatViewModel,
  type ChatViewModelInterface,
  type ChatViewModelOptions,
} from "$views/chat/chat_view_model.svelte.ts";
import type { ChatMessage } from "@aikami/types";

export class ChatDevViewModel
  extends ChatViewModel
  implements ChatViewModelInterface
{
  constructor(options: ChatViewModelOptions) {
    super(options);
  }

  // 🔑 Override the API/fetch method — inject mock data
  override async loadMessages(): Promise<void> {
    this.debug("loadMessages:dev — injecting mock data");
    await new Promise((r) => setTimeout(r, 300)); // simulate network delay
    this._setMessages(MOCK_MESSAGES);
  }

  // 🔑 Override send to simulate locally
  override async sendMessage(text: string): Promise<void> {
    this.debug("sendMessage:dev", { text });
    const mockMessage: ChatMessage = {
      id: crypto.randomUUID(),
      text,
      timestamp: Date.now(),
    };
    this._prependMessage(mockMessage);
  }

  // Expose dev-only controls to the dev view
  injectNetworkError(): void {
    this._setError("Simulated network error — test error UI");
  }

  simulateSlowLoad(delayMs: number = 5000): void {
    this.debug("simulateSlowLoad", { delayMs });
    // triggers loading state for spinner/stale-while-load testing
  }

  resetToEmpty(): void {
    this._reset();
  }
}

const MOCK_MESSAGES: ChatMessage[] = [
  { id: "m1", text: "Hello from mock data!", timestamp: Date.now() - 60000 },
  { id: "m2", text: "This is a simulated response.", timestamp: Date.now() - 30000 },
];

export const getChatDevViewModel = (
  options: ChatViewModelOptions,
): ChatViewModelInterface => new ChatDevViewModel(options);
```

**Rules:**

- Dev ViewModel class **must** `extends` the production ViewModel class
- **Only override** methods that perform I/O: `fetch`, API calls, Firebase
  reads/writes, microservice invocations
- **Never override** pure logic, validation, or state management methods
- Dev files live under `$views/(dev)/<feature>/` — mirroring the production
  path structure
- Dev views can reuse the production view component directly, or add a thin
  wrapper if dev-only UI controls are needed (reset buttons, error injectors,
  etc.)
- Mock data must be representative of real API responses — same shape,
  realistic values
- Dev sandbox routes are excluded from production builds via `adapter-static`
  config

---

## 1. Svelte 5 Core

### Reactivity is Runes ONLY

No `$:` syntax. No stores (`writable`, `readable`).

```typescript
let count = $state(0);              // State
let doubled = $derived(count * 2);  // Derived
$effect(() => { console.log(count); }); // Side effects
```

### Props

```svelte
let { user, theme = 'dark' } = $props();
let { value = $bindable() } = $props();
```

### Event Handlers

Use HTML `onclick`, not Svelte 4 `on:click`:

```svelte
<button onclick={handleClick}>Click</button>
```

### TypeScript in Svelte

Always use `<script lang="ts">`. All `.svelte.ts` files (ViewModels) are
first-class TypeScript modules with Svelte 5 rune support.

## 2. ViewModel Pattern

**Views have zero logic** — they are pure HTML/Svelte wrappers. No conditionals,
no data transformation, no `onMount`. Every expression in the view template
must be a direct property access on the ViewModel.

**ViewModels are thin bridges to services** — orchestrate service calls, expose
state to the view, but never contain heavy business logic, import repositories,
or call API/firebase functions directly. That belongs in services.

No local `$state` in views. No `onMount`.

### Architecture Rules

- ❌ **Svelte stores** → Use singleton services with `$state`
- ❌ **Local `$state` in views** → All state belongs in the ViewModel
- ❌ **`onMount` for initialization** → Use `initialize()` method in ViewModel
- ❌ **Destructuring ViewModels** → Always access directly (`viewModel.show`)
- ❌ **`$derived` to proxy service state** → Use native getters
- ❌ **Business logic in ViewModels** → Delegate to services, never import repositories or call APIs
- ❌ **`fetch`, `AudioContext`, `URL.createObjectURL`, or any browser API in ViewModels** → All I/O and platform APIs belong in services
- ❌ **Private `_service` field storing a service singleton** → Reference the singleton directly (`ttsService.speak()`, not `this._service.speak()`)
- ❌ **Conditionals / data transforms in views** → Compute in the ViewModel, expose ready-to-render data
- ✅ **Private members prefixed with `_`** — `_cache`, `_pendingRequests`, `_normalizeInput()`

### ViewModel Interface — All Properties `readonly`

Interface properties exposed to the view must be `readonly` so the view cannot
mutate state directly:

```typescript
export type FeatureViewModelInterface = BaseViewModelInterface & {
  readonly items: string[];
};
```

TypeScript enforces this at compile time — the view can only read, never write.
The ViewModel class still owns mutable `$state` internally.

**Exception**: ViewModel `$state` fields listed in the interface are **public** —
do NOT prefix them with `_`. Private helper methods/fields not in the
interface MUST use `_` prefix (see `aikami-conventions`).

### ViewModel Template

```typescript
// apps/frontend/pwa/src/lib/views/feature/feature_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from "@aikami/frontend/services";
import { myService } from "$services";

export type FeatureViewModelInterface = BaseViewModelInterface & {
  readonly items: string[];
};

export type FeatureViewModelOptions = BaseViewModelOptions & {};

export class FeatureViewModel
  extends BaseViewModel<FeatureViewModelOptions>
  implements FeatureViewModelInterface
{
  // ViewModel-owned $state for form inputs bound to the view
  inputText = $state('');

  // Service state proxied via native getters — never $derived
  get items(): string[] {
    return myService.items;
  }

  get isLoading(): boolean {
    return myService.isLoading;
  }

  // ── Public API ────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.debug("initialize");
    await myService.loadItems();
  }

  async submit(): Promise<void> {
    this.debug("submit");
    await myService.process(this.inputText);
  }

  cancel(): void {
    this.debug("cancel");
    myService.cancel();
  }
}

export const getFeatureViewModel = (
  options: FeatureViewModelOptions,
): FeatureViewModelInterface => {
  return new FeatureViewModel(options);
};
```

### View Template

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

### Rules

- Export `type ...Interface` with **all properties `readonly`**
- Export `type ...Options` alongside the class
- Export a `getFeatureViewModel` factory function
- Always extend `BaseViewModel` and `implements *Interface`
- ViewModel files: `{name}_view_model.svelte.ts` (NOT `vm` shorthand)
- ViewModel imports services, **never** repositories or Firebase SDK directly
- **Reference service singletons directly** — `myService.doThing()`, never `this._service.doThing()`
- **Proxy service state via native getters** — `get items() { return myService.items; }`, never `$derived`
- **Never call `fetch`, `AudioContext`, or any browser API** — all I/O belongs in services
- ViewModel-owned `$state` is for form inputs bound to the view (`inputText`, `prompt`, `text`), never for business state

### ViewModel — `super.initialize()` Placement

Always call `super.initialize()` **at the end** of `initialize()`. This keeps
the loading overlay visible until data is loaded:

```typescript
// ✅ Correct — loading screen stays until data is ready
override async initialize(): Promise<void> {
  await automationService.load();  // data first
  return await super.initialize(); // then clear loading screen
}

// ❌ Wrong — loading screen disappears before data arrives
override async initialize(): Promise<void> {
  await super.initialize();        // too early
  await automationService.load();
}
```

### ViewModel — Navigation Methods

Navigation methods must be `async` and use `await`:

```typescript
// ✅ Correct
async cancel(): Promise<void> {
  await routerService.goToRoute('agents', { pathParameters: undefined, queryParameters: undefined });
}

// ❌ Wrong — void hides errors
cancel(): void {
  void routerService.goToRoute('agents', ...);
}
```

### ViewModel — Link Click Handlers with `preventDefault`

When using `<a href="...">` for navigation (SEO/accessibility), the ViewModel
provides a `handle*Link(event)` method that calls `event.preventDefault()` before
navigating. This keeps DOM concerns **out of the view template**:

```typescript
// ViewModel
handleBackLink(event: MouseEvent): void {
  event.preventDefault();
  void this.navigateBack();
}
```

```svelte
<!-- View — clean, no inline DOM logic -->
<a href="/agents" onclick={(e) => viewModel.handleBackLink(e)}>
  ← All agents
</a>

<!-- ❌ Wrong — DOM logic in view template -->
<a href="/agents" onclick={(e) => { e.preventDefault(); viewModel.cancel(); }}>
```

### ViewModel — Never Abbreviate `viewModel`

Never abbreviate `viewModel` as `vm`, `const`, `val`, or any other shorthand.
Use `viewModel` everywhere in the template:

```svelte
<!-- ✅ Correct -->
{viewModel.items}
<button onclick={() => viewModel.handleClick()}>

<!-- ❌ Wrong -->
{vm.items}
<button onclick={() => vm.handleClick()}>
```

### ViewModel — Never Import Data Directly in a View

Views access data only through the ViewModel. Add a getter on the ViewModel
instead of importing constants/data directly:

```typescript
// ✅ Correct — getter on ViewModel
get departmentTemplates(): DepartmentTemplate[] {
  return DEPARTMENT_TEMPLATES;
}
```

```svelte
<!-- View accesses via viewModel -->
{#each viewModel.departmentTemplates as template}
```

```svelte
<!-- ❌ Wrong — view imports data directly -->
<script>
  import { DEPARTMENT_TEMPLATES } from '$lib/data/departments';
</script>
{#each DEPARTMENT_TEMPLATES as template}
```

### View File Location

Views belong at `$views/<route-path>/` — matching the route structure:

- Multi-page features use subfolders: `$views/agents/library/`, `$views/agents/new/`, `$views/agents/detail/`
- Layout components go in `$views/app/<category>/`
- Single-page features go directly under `$views/<name>/`

### ViewModel — Block Statements

Always use block statements for `if`/`else`/`return`:

```typescript
// ✅ Correct
if (!this.canCreate) { return; }

// ❌ Wrong — Biome rejects this
if (!this.canCreate) return;
```

---

## 3. Services Architecture

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
    // ...
  }
}

export const myService = new MyService();
```

Access in ViewModels via native getters (NOT `$derived`):

```typescript
// ❌ WRONG
confirmDialog = $derived(dialogService.confirmDialog);

// ✅ CORRECT
get confirmDialog() { return dialogService.confirmDialog; }
```

### Service Conventions

#### 1. File Naming: Must End in `.svelte.ts`

Service files use `$state` runes, which require the `.svelte.ts` extension:

```typescript
// ✅ CORRECT
my_service.svelte.ts

// ❌ WRONG
my_service.ts
```

#### 2. Never Export Schemas or Types from Services

Schemas and types belong in `@aikami/schemas` / `@aikami/types` (cross-project)
or local `types/index.ts` (app-local). Services import them, never define or
re-export them. See `aikami-conventions`.

The only exception is the service's own **interface and options type**:

```typescript
export type MyServiceOptions = BaseFrontendClassOptions & { ... };
export type MyServiceInterface = BaseFrontendClassInterface & { ... };
```

#### 3. Export Singleton Instance at Bottom

Every service exports a singleton instance at the end of the file with the
interface type annotation and `className`. Private internal members (caches,
maps, counters) use `_` prefix.

```typescript
export const myService: MyServiceInterface = new MyService({
  className: "MyService",
});
```

**Never** do any of these:

```typescript
// ❌ WRONG — exports the class, not an instance
export const myService = MyService;

// ❌ WRONG — no className, no type annotation
export const myService = new MyService();

// ❌ WRONG — factory function, no singleton
export const createMyService = () => new MyService();
```

#### 4. Export from Services Index

Every service must be re-exported from `apps/frontend/pwa/src/lib/client/services/index.ts`
so consumers can import from a single path:

```typescript
// apps/frontend/pwa/src/lib/client/services/index.ts
export * from './game/game_state_service.svelte.ts';
```

## 4. Import Aliases

| Alias       | Target                      |
| ----------- | --------------------------- |
| `$lib`      | `apps/frontend/pwa/src/lib` |
| `$types`    | `@aikami/types`             |
| `$services` | Services layer              |
| `$logger`   | Environment-specific (see `aikami-conventions`) |
| `$views`    | `$lib/views`                |

Always import from alias root (no `lib/` sub-paths — see `aikami-conventions`):

```typescript
// ✅ CORRECT
import type { User } from "$types";
import { logger } from "$logger";

// ❌ WRONG
import type { User } from "$types/lib/user";
```

## 5. Game Engine Boundary

The PixiJS v8 + bitECS game engine runs inside the SvelteKit PWA. The boundary
is documented in the `pixijs-v8` skill — always load it when working on game
code, engine-to-UI communication, or any file in `apps/frontend/pwa/src/lib/game/`.

Critical rules:

- **No `$state` in game code** — `apps/frontend/pwa/src/lib/game/` is a pure
  imperative TypeScript zone. `$state` in the game loop crashes Svelte.
- **All UI ↔ Game communication** goes through the typed `EngineBridge`.
- **Bridge payloads must be plain serializable objects** — no PixiJS objects,
  no bitECS handles.

See `pixijs-v8` skill for the full boundary spec.
