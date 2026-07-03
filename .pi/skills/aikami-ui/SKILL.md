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

When you need a complex component that doesn't exist yet: add it to
`@aikami/frontend-components`, never inline a one-off in the consuming app.

---

## Rule 2: Typography — `font-mono` and `font-sans` ONLY

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

## Rule 3: Semantic Colors — DaisyUI Tokens, Never Hex

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

## Rule 4: Global CSS — `app.css` is the Single Source

**🔴 All global CSS changes (fonts, theme variables, scrollbar styles, animations)
go in `apps/frontend/client/src/app.css` — nowhere else.**

- ❌ No `<style>` blocks in Svelte files for global utilities
- ❌ No `@layer` directives in component files
- ❌ No inline `@theme` blocks outside `app.css`
- ✅ Component-scoped `<style>` blocks are fine for component-local styles

---

## Rule 5: DaisyUI Plugin Positioning

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
