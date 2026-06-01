---
name: svelte-page
description: Scaffold a new SvelteKit page conforming to the Svelte 5 View and ViewModel pattern.
---

# Svelte Page Scaffolding Skill

Use this skill when adding a new page or view component to the SvelteKit app.

> **See `svelte-conventions` for**: full ViewModel template, View template, interface patterns, import aliases, and all conventions.
>
> **See `aikami-conventions` for**: snake_case file naming, `_` prefix, arrow functions, error handling.

---

## What to Create

Three files per page:

| # | File | Location |
|---|------|----------|
| 1 | ViewModel | `apps/frontend/pwa/src/lib/views/<name>/<name>_view_model.svelte.ts` |
| 2 | View | `apps/frontend/pwa/src/lib/views/<name>/<name>_view.svelte` |
| 3 | Route page | `apps/frontend/pwa/src/routes/<route>/+page.svelte` |

---

## 1. ViewModel

Follow the template in `svelte-conventions` → ViewModel Pattern.

- Extend `BaseViewModel`, implement `<Name>ViewModelInterface`
- Export `get<Name>ViewModel` factory function
- `initialize()` calls `super.initialize()` at the end
- File: `{name}_view_model.svelte.ts`

## 2. View

Follow the template in `svelte-conventions` → View Template.

- Wrap in `<BaseViewModelContainer {viewModel}>`
- Zero logic — only property access on `viewModel`
- File: `{name}_view.svelte`

## 3. Route Page

```svelte
<script lang="ts">
  // apps/frontend/pwa/src/routes/<route>/+page.svelte
  import <Name>View from '$views/<name>/<name>_view.svelte';
  import { get<Name>ViewModel } from '$views/<name>/<name>_view_model.svelte.ts';

  const viewModel = get<Name>ViewModel({ className: '<Name>ViewModel' });
</script>

<<Name>View {viewModel} />
```

Do NOT call `.initialize()` here — `BaseViewModelContainer` handles that.
