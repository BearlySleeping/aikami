---
name: aikami-ui
description: >-
    Load for any frontend UI, styling, or Tailwind/DaisyUI tasks. Dictates
    when to use raw HTML vs @aikami/frontend-components, strict typography,
    semantic colors, and where global CSS lives.
version: 1.0.0
tags: ["aikami", "ui", "tailwind", "daisyui", "components", "frontend"]
---

# Aikami UI & Theming

**🔴 LOAD BEFORE writing any Svelte UI, Tailwind classes, or component code.**
These rules prevent AI hallucination of arbitrary fonts, hex colors, and
reinvented DaisyUI primitives.

---

## Rule 1: Primitive vs Complex Components

| Component Type                            | Pattern                                   |
| ----------------------------------------- | ----------------------------------------- |
| **Primitive DaisyUI** (buttons, badges,   | Raw HTML with DaisyUI classes.            |
| inputs, labels, toasts, loading spinners, | **NEVER wrap inside `@aikami/frontend-components`.** |
| kbd, stats)                               | |
| **Complex UI** (Select, Dropdown, Modal,  | Encapsulated in `@aikami/frontend-components`. |
| Form, Tabs)                               | These manage internal state, accessibility,   |
|                                           | and complex DaisyUI HTML structures.          |

```svelte
<!-- ✅ CORRECT — primitive: raw HTML + DaisyUI classes -->
<button class="btn btn-primary">Save</button>
<span class="badge badge-success">Active</span>
<input class="input input-bordered" />

<!-- ✅ CORRECT — complex: imported component -->
<script lang="ts">
  import { Select } from '@aikami/frontend-components';
</script>
<Select {options} bind:value />

<!-- ❌ WRONG — wrapping a primitive DaisyUI element in a component -->
<script lang="ts">
  import { Button } from '$lib/components/my_button.svelte';
</script>
```

**Current `@aikami/frontend-components` exports:**
- `Select` — DaisyUI `<select>` wrapper with `$bindable()` value, JSDoc props,
  `SelectOption[]` options, and `size`/`bordered` DaisyUI modifiers.
- `Modal` — Native `<dialog>` wrapper with `$bindable()` open, title/children/actions
  snippets, `size` variants, backdrop click dismissal, and `onclose` callback.

When you need a complex component that doesn't exist yet: add it to
`@aikami/frontend-components`, never inline a one-off in the consuming app.

---

## Rule 2: Component Purity — Dumb Components Only

**🔴 `@aikami/frontend-components` must remain 100% pure and stateless.
Never import business logic, ViewModels, or services into the component library.**

| ❌ NEVER in `@aikami/frontend-components` | ✅ MUST pattern                          |
| ----------------------------------------- | ---------------------------------------- |
| `extends BaseViewModel` or `extends BaseClass` | Extend nothing (pure Svelte component) |
| `import { ... } from '$services'`         | Accept everything via `$props()`         |
| `$state()` / `$derived()` / `$effect()` for business state | `$props()` only; Svelte runes for internal UI state (open/closed) OK |
| Direct Firebase SDK, repository, or service calls | Callbacks: `onchange`, `onclose`, etc. |
| `onMount()` with data fetching            | Consumer ViewModel fetches, passes via props |

Components in this library are the "Shadcn layer" — pure template wrappers
around DaisyUI HTML structures. They accept `$props()`, manage **internal UI
state only** (e.g., is a dropdown open?), and communicate back via callbacks.

```svelte
<!-- ✅ CORRECT — pure component: $props() + callbacks only -->
<script lang="ts">
  type Props = {
    value: string;
    options: SelectOption[];
    onchange?: (value: string) => void;
  };
  let { value = $bindable(), options, onchange }: Props = $props();
</script>

<!-- ❌ WRONG — component importing services or extending BaseClass -->
<script lang="ts">
  import { myService } from '$services/my_service';
  import { BaseClass } from '@aikami/utils';
</script>
```

If you need reactive business state: that belongs in a **ViewModel**
(`_view_model.svelte.ts`), not in the component.

---

## Rule 3: Typography — `font-mono` and `font-sans` ONLY

**🔴 NEVER use arbitrary font-family utilities or inline font declarations.**

The Client's global `apps/frontend/client/src/app.css` defines Tailwind v4
`@theme` variables. These are the **sole** font sources:

```css
/* apps/frontend/client/src/app.css */
@import "tailwindcss";
@plugin "daisyui" {
  themes:
    light --default,
    dark --prefersdark;
}

@theme {
  --font-mono: "JetBrains Mono", monospace;
  --font-sans: "Inter", sans-serif;
}
```

| ✅ DO                                                                    | ❌ NEVER                               |
| ------------------------------------------------------------------------ | -------------------------------------- |
| `class="font-mono"`                                                      | `class="font-['JetBrains_Mono']"`      |
| `class="font-sans"`                                                      | `class="font-['Inter']"`               |
|                                                                          | `class="font-mono" style="font-family: ..."` |
|                                                                          | Any other font-family utility          |

If you need a new font family: add it to the `@theme` block in `app.css` —
never inline it.

---

## Rule 4: Semantic Colors — DaisyUI Tokens, Never Hex

**🔴 NEVER use hardcoded hex colors (`#fff`, `text-[#1a1a1a]`, etc.).**

Use DaisyUI's semantic color tokens. They adapt to the active theme (light/dark).

```svelte
<!-- ✅ CORRECT — semantic DaisyUI color tokens -->
<div class="bg-base-100 text-base-content">
<span class="text-primary">Highlighted</span>
<span class="text-error">Error message</span>
<div class="border-base-300 border">

<!-- ❌ WRONG — hardcoded hex colors -->
<div class="bg-[#ffffff] text-[#1a1a1a]">
<span class="text-[#ff0000]">
<div style="color: #333;">
```

**DaisyUI semantic token reference:**

| Token              | Purpose                              |
| ------------------ | ------------------------------------ |
| `base-100`/`200`/`300` | Background surfaces (lightest → darkest) |
| `base-content`     | Primary text on base backgrounds     |
| `primary`          | Brand color (buttons, links)         |
| `primary-content`  | Text on primary backgrounds          |
| `secondary`        | Accent color                         |
| `accent`           | Highlight color                      |
| `neutral`          | Muted backgrounds                    |
| `neutral-content`  | Text on neutral backgrounds          |
| `info`             | Informational states                 |
| `success`          | Positive states                      |
| `warning`          | Caution states                       |
| `error`            | Error/destructive states             |

For opacity adjustments, use Tailwind opacity modifiers: `bg-primary/50`,
`text-base-content/80`. Never use `opacity-50` on a container that holds text.

---

## Rule 5: Global CSS — `app.css` is the Single Source

**🔴 All global CSS changes (fonts, theme variables, scrollbar styles, animations)
go in `apps/frontend/client/src/app.css` — nowhere else.**

- ❌ No `<style>` blocks in Svelte files for global utilities
- ❌ No `@layer` directives in component files
- ❌ No inline `@theme` blocks outside `app.css`
- ✅ Component-scoped `<style>` blocks are fine for component-local styles

---

## Rule 6: DaisyUI Plugin Positioning

The `@plugin "daisyui"` import **must precede** the `@theme` block in `app.css`
so DaisyUI theme variables cascade correctly:

```css
@import "tailwindcss";
@plugin "daisyui" {   /* ← DaisyUI registers its theme tokens first */
  themes:
    light --default,
    dark --prefersdark;
}

@theme {               /* ← custom overrides go after */
  --font-mono: "JetBrains Mono", monospace;
  --font-sans: "Inter", sans-serif;
}
```

---

## Quick-Reference Cheatsheet

| Context                                       | Use                                     |
| --------------------------------------------- | --------------------------------------- |
| Button                                        | `<button class="btn btn-primary">`      |
| Badge/status                                   | `<span class="badge badge-success">`    |
| Text input                                    | `<input class="input input-bordered">`  |
| Select dropdown                               | `<Select {options} bind:value />`       |
| Modals, dropdowns, tabs (complex stateful)    | `@aikami/frontend-components`           |
| Code/text blocks                              | `class="font-mono"`                     |
| Body/UI text                                  | `class="font-sans"`                     |
| Colors                                        | `bg-base-100` / `text-primary` / etc.   |
| Opacity                                       | `bg-primary/50`                         |
| Global CSS change                             | `app.css` `@theme` block                |

---

## Rule 7: Accessibility — No Ignores, Semantic Elements Only

**🔴 NEVER add `svelte-ignore a11y_*` or `biome-ignore lint/a11y/*` comments.**
Fix the underlying a11y issue instead. The linter rules exist to enforce real
accessibility requirements.

### 7a: Interactive elements MUST be semantic

| Pattern | ✅ DO | ❌ NEVER |
|---|---|---|
| Clickable overlay/backdrop | `<button type="button" class="..." aria-label="Close">` | `<div onclick={...}>` |
| Clickable card/container | `<button type="button" class="..." aria-label="...">` | `<div role="button" onclick={...}>` |
| **Exception**: Card with nested `<button>` children | `<div role="button" tabindex="0" onclick={...} onkeydown={...}>` + single `biome-ignore` for `useSemanticElements` | `<button>` (HTML forbids nested buttons) |
| Modal backdrop with nested interactive children | `<div role="dialog" aria-modal="true" tabindex="-1">` | `<button>` (can't nest buttons) |

### 7b: Modal / dialog backdrops

Every modal overlay MUST have all of:
- `role="dialog"`
- `aria-modal="true"`
- `tabindex="-1"`
- `onclick` for backdrop-close (using `e.target === e.currentTarget`)
- `onkeydown` for Escape key dismissal

```svelte
<!-- ✅ CORRECT — modal backdrop overlay -->
{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) close(); }}
    onkeydown={(e) => { if (e.key === 'Escape') close(); }}
  >
    <div class="modal-box">
      <!-- content -->
    </div>
  </div>
{/if}
```

**🔴 Use `e.target === e.currentTarget` — NEVER `onclick stopPropagation` on children.**
The `stopPropagation` pattern requires extra event handlers on child divs which
triggers `noStaticElementInteractions` and `useKeyWithClickEvents`.

### 7c: Labels MUST have `for` / `id`

Every `<label>` element must be associated with a form control:

```svelte
<!-- ✅ CORRECT -->
<label for="name-input" class="...">Name</label>
<input id="name-input" class="input input-bordered" />

<!-- ❌ WRONG -->
<label class="...">Name</label>
<input class="input input-bordered" />
```

**Static text headers that look like labels**: Use `<span>`, `<h4>`, or `<div>` —
NOT `<label>`. The `<label>` element is only for form controls.

**Group of inputs with a label**: Use `<fieldset>` + `<legend>`:

```svelte
<!-- ✅ CORRECT -->
<fieldset class="border-0 p-0">
  <legend class="text-xs font-semibold">Per-Image Tags</legend>
  <!-- grouped inputs -->
</fieldset>
```

### 7d: Form controls MUST have `type` attributes

Every `<button>` outside a `<form>` needs `type="button"` (prevents accidental
form submission). Inside a form, use `type="submit"` for submit buttons.

### 7e: Media elements MUST have captions

Every `<audio>` and `<video>` element must include a `<track>`:

```svelte
<audio controls class="w-full">
  <source src={url}>
  <track kind="captions">
</audio>
```

### 7f: Alt text — no redundant "image"/"picture"/"photo"

Screen readers already announce "image" — don't repeat it in alt text.

```svelte
<!-- ❌ WRONG -->
<img src={url} alt="Gallery image">
<img src={url} alt="Picture of a dragon">

<!-- ✅ CORRECT -->
<img src={url} alt="Generated artwork">
<img src={url} alt="Red dragon breathing fire">
```

### 7g: Fullscreen image modals

```svelte
{#if expandedUrl}
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={() => (expandedUrl = null)}
    onkeydown={(e) => { if (e.key === 'Escape') { expandedUrl = null; } }}
  >
    <button type="button"
      class="absolute top-4 right-4 btn btn-sm btn-ghost text-white text-xl"
      onclick={() => (expandedUrl = null)}>✕</button>
    <img src={expandedUrl} alt="Combat scene (fullscreen)"
      class="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl">
  </div>
{/if}
```

### 7h: DaisyUI dialog / modal-backdrop

When using DaisyUI's `.modal` / `.modal-backdrop` pattern, the backdrop element
must be a `<button>` (not `<div>`):

```svelte
<div class="modal modal-open">
  <div class="modal-box">
    <!-- content -->
  </div>
  <button
    type="button"
    class="modal-backdrop border-none bg-transparent p-0"
    onclick={() => close()}
    onkeydown={(e) => { if (e.key === 'Enter') close(); }}
    aria-label="Close"
  ></button>
</div>
```

Note: DaisyUI `.modal-backdrop` on a `<button>` needs `border-none bg-transparent p-0`
to reset default button styling.
