---
name: svelte-page
description: Scaffold a new SvelteKit page, route, or view component. Use when creating a new page, route, view, or when adding a SvelteKit route. Covers ViewModel + View + route page pattern with BaseViewModelContainer lifecycle.
---

# Svelte Page Scaffolding Skill

Use this skill when adding a new page or view component to the SvelteKit app.

> **See `svelte-conventions` for**: full ViewModel template, View constraints, interface patterns, import aliases, and all Svelte 5 rules.
>
> **See `aikami-conventions` for**: snake_case file naming, `_` prefix, arrow functions, error handling.

---

## What to Create

Three files per page:

| # | File | Location |
|---|------|----------|
| 1 | ViewModel | `apps/frontend/client/src/lib/views/<name>/<name>_view_model.svelte.ts` |
| 2 | View | `apps/frontend/client/src/lib/views/<name>/<name>_view.svelte` |
| 3 | Route page | `apps/frontend/client/src/routes/<route>/+page.svelte` |

---

## 1. ViewModel

Follow the template in `svelte-conventions` → ViewModel Pattern.

- Extend `BaseViewModel` (from `@aikami/frontend/services`), implement `<Name>ViewModelInterface`
- Interface methods use method shorthand: `close(): void`, NOT `close: () => void`
- Export `get<Name>ViewModel` factory function using `ClassName.create()`
- `initialize()` calls `super.initialize()` at the end
- Logging via inherited `this.debug()` / `this.error()` — never import `$logger`
- File: `{name}_view_model.svelte.ts`

## 2. View

Follow the constraints in `svelte-conventions` → View Structural Constraints.

- Wrap in `<BaseViewModelContainer {viewModel}>` (import from
  `$lib/components/base_view_model_container.svelte`)
- Zero logic — only property access on `viewModel`
- Event handlers use arrow wrappers: `onclick={() => viewModel.method()}` —
  never `onclick={viewModel.method}`
- File: `{name}_view.svelte`

## 3. Route Page

```svelte
<script lang="ts">
  // apps/frontend/client/src/routes/<route>/+page.svelte
  import <Name>View from '$views/<name>/<name>_view.svelte';
  import { get<Name>ViewModel } from '$views/<name>/<name>_view_model.svelte.ts';

  const viewModel = get<Name>ViewModel({ className: '<Name>ViewModel' });
</script>

<<Name>View {viewModel} />
```

Do NOT call `.initialize()` here — `BaseViewModelContainer` handles that.
