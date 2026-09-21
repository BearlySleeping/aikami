---
name: aikami-ui
description: >-
    Load for any frontend UI, styling, or Tailwind/Aikami UI task. Dictates
    when to use raw HTML + Aikami semantic classes vs @aikami/frontend-components,
    strict typography, semantic color tokens, and where global CSS lives.
version: 2.0.0
tags: ["aikami", "ui", "tailwind", "components", "frontend"]
---

# Aikami UI & Theming

**🔴 LOAD BEFORE writing any Svelte UI, Tailwind classes, or component code.**
These rules prevent AI hallucination of arbitrary fonts, hex colors, and
reinvented UI primitives.

**The client and hub use plain Tailwind v4 — there is no daisyUI plugin.**
The design system is owned by `@aikami/frontend/theme`:

| File | Responsibility |
| --- | --- |
| `packages/frontend/theme/src/lib/aikami_theme.css` | Semantic palette (`--ui-*`) + Tailwind `@theme` registration (`--color-*`). |
| `packages/frontend/theme/src/lib/aikami_ui.css` | Component classes (`btn`, `badge`, `input`, `modal`, `tabs`, ...) built from those tokens. |
| `packages/frontend/theme/src/lib/brand_tokens.css` | Plain shadcn-style variables for the site + docs apps. |

Both apps import the theme from `app.css`:

```css
/* apps/frontend/client/src/app.css */
@import "tailwindcss";
@import "@aikami/frontend/theme/aikami_theme.css";
@import "@aikami/frontend/theme/aikami_ui.css";

@theme {
  --font-mono: "JetBrains Mono", monospace;
  --font-sans: "Inter", sans-serif;
}
```

The class names intentionally mirror the former daisyUI API so markup stayed
stable through the migration — but every style is now Aikami-owned. **If a
class is missing, add it to `aikami_ui.css` (one source of truth). Never
reach for the daisyUI plugin, and never copy daisyUI's implementation.**

---

## Rule 1: Primitive classes vs complex components

| Component type | Pattern |
| --- | --- |
| **Primitives** (buttons, badges, inputs, textareas, selects, checkboxes, toggles, ranges, progress, loading spinners, kbd, dividers, labels) | Raw HTML with Aikami classes. **NEVER wrap a primitive in a trivial Svelte component.** |
| **Complex / structured / stateful** (Select, Modal, tabs, dropdowns, autocomplete, drawers) | Encapsulated in `@aikami/frontend-components` (shared) or `apps/frontend/client/src/lib/components/`. |

```svelte
<!-- ✅ CORRECT — primitive: raw HTML + Aikami classes -->
<button class="btn btn-primary">Save</button>
<span class="badge badge-success">Active</span>
<input class="input input-bordered" />

<!-- ✅ CORRECT — complex: imported component -->
<script lang="ts">
  import { Select } from '@aikami/frontend-components';
</script>
<Select {options} bind:value />

<!-- ❌ WRONG — wrapping a primitive in a one-off component -->
<script lang="ts">
  import { Button } from '$lib/components/my_button.svelte';
</script>
```

When you need a complex component that doesn't exist yet, add it to
`@aikami/frontend-components` (shared across client + hub) or, if it is
client-only, to `apps/frontend/client/src/lib/components/` and export it from
`.../components/index.ts`.

---

## Rule 2: Component purity — dumb components only

**🔴 `@aikami/frontend-components` must remain 100% pure and stateless. Never
import business logic, ViewModels, or services into the component library.**

| ❌ NEVER in `@aikami/frontend-components` | ✅ MUST pattern |
| --- | --- |
| `extends BaseViewModel` / `BaseClass` | Extend nothing (pure Svelte component) |
| `import { ... } from '$services'` | Accept everything via `$props()` |
| Business state in `$state()` / `$derived()` / `$effect()` | `$props()` only; runes for internal UI state (open/closed) OK |
| Repository, database, or service calls | Callbacks: `onchange`, `onclose`, ... |
| `onMount()` with data fetching | Consumer ViewModel fetches, passes via props |

If you need reactive business state, that belongs in a **ViewModel**
(`_view_model.svelte.ts`), not in a component.

---

## Rule 3: Typography — `font-mono` and `font-sans` ONLY

**🔴 NEVER use arbitrary font-family utilities or inline font declarations.**

The `@theme` block in each app's `app.css` is the sole font source.

| ✅ DO | ❌ NEVER |
| --- | --- |
| `class="font-mono"` | `class="font-['JetBrains_Mono']"` |
| `class="font-sans"` | `class="font-['Inter']"` |
| | `class="font-mono" style="font-family: ..."` |

If you need a new font family, add it to the `@theme` block — never inline it.

---

## Rule 4: Semantic colors — Aikami tokens, never hex

**🔴 NEVER use hardcoded hex colors (`#fff`, `text-[#1a1a1a]`, ...).**

Use the semantic tokens registered by `aikami_theme.css`. They adapt to the
active theme (light / dark).

```svelte
<!-- ✅ CORRECT — semantic tokens -->
<div class="bg-base-100 text-base-content">
<span class="text-primary">Highlighted</span>
<span class="text-error">Error message</span>
<div class="border-base-300 border">

<!-- ❌ WRONG — hardcoded hex colors -->
<div class="bg-[#ffffff] text-[#1a1a1a]">
<span class="text-[#ff0000]">
<div style="color: #333;">
```

**Token reference:**

| Token | Purpose |
| --- | --- |
| `base-100` / `200` / `300` | Background surfaces (lightest → darkest) |
| `base-content` | Primary text on base backgrounds |
| `primary` | Brand color (rune purple) |
| `primary-content` | Text on primary backgrounds |
| `secondary` | Accent color |
| `accent` | Highlight color |
| `neutral` | Muted backgrounds |
| `neutral-content` | Text on neutral backgrounds |
| `info` / `success` / `warning` / `error` | Status colors (each has `-content`) |

For opacity, use Tailwind modifiers: `bg-primary/50`,
`text-base-content/80`. Never use `opacity-50` on a container that holds text.

---

## Rule 5: Global CSS — `app.css` is the single source

**🔴 All global CSS changes go in the app's `app.css` or the shared theme
package — nowhere else.**

- ❌ No `<style>` blocks in Svelte files for global utilities
- ❌ No `@layer` directives in component files
- ❌ No `@theme` blocks outside `app.css` / `aikami_theme.css`
- ✅ Component-scoped `<style>` blocks are fine for component-local styles

New reusable component classes (the vocabulary every app shares) belong in
`packages/frontend/theme/src/lib/aikami_ui.css`. New semantic tokens belong in
`aikami_theme.css`.

---

## Rule 6: Theme import order

`@import "tailwindcss"` must come first, then the shared theme files, then the
app's own `@theme` overrides:

```css
@import "tailwindcss";
@import "@aikami/frontend/theme/aikami_theme.css";
@import "@aikami/frontend/theme/aikami_ui.css";

@theme {
  --font-mono: "JetBrains Mono", monospace;
  --font-sans: "Inter", sans-serif;
}
```

The palette lives in `:root` as `--ui-*` custom properties (light) and in the
`prefers-color-scheme: dark` / `[data-theme="dark"]` block (dark). The
`@theme` block maps them onto `--color-*` so Tailwind generates
`bg-base-100`, `text-primary`, and opacity variants automatically. A theme
switch only has to redefine `--ui-*`.

---

## Rule 7: Accessibility — no ignores, semantic elements only

**🔴 NEVER add `svelte-ignore a11y_*` or `biome-ignore lint/a11y/*` comments.**
Fix the underlying issue instead.

### 7a: Interactive elements MUST be semantic

| Pattern | ✅ DO | ❌ NEVER |
| --- | --- | --- |
| Clickable overlay/backdrop | `<button type="button" class="..." aria-label="Close">` | `<div onclick={...}>` |
| Clickable card/container | `<button type="button" class="..." aria-label="...">` | `<div role="button" onclick={...}>` |
| **Exception**: card with nested `<button>` children | `<div role="button" tabindex="0" onclick={...} onkeydown={...}>` + single `biome-ignore` for `useSemanticElements` | `<button>` (HTML forbids nested buttons) |

### 7b: Modal / dialog backdrops

Prefer the shared `Modal` component (`@aikami/frontend-components`) — it wraps
a native `<dialog>` and handles `showModal()`, backdrop dismissal, Escape, and
the `onclose` callback for you.

If you build a custom overlay, every modal must have `role="dialog"`,
`aria-modal="true"`, `tabindex="-1"`, backdrop-close via
`e.target === e.currentTarget`, and Escape handling in `onkeydown`. Use
`e.target === e.currentTarget` — never `stopPropagation` on children.

### 7c: Labels MUST have `for` / `id`

Every `<label>` must be associated with a form control. Static text headers
that merely look like labels use `<span>` / `<h4>` / `<div>`. Group inputs with
`<fieldset>` + `<legend>`.

### 7d: Form controls MUST have `type` attributes

Every `<button>` outside a `<form>` needs `type="button"`; inside a form use
`type="submit"` for the submit button.

### 7e: Media elements MUST have captions

Every `<audio>` / `<video>` includes a `<track kind="captions">`.

### 7f: Alt text — no redundant "image"/"picture"/"photo"

Screen readers already announce "image".

### 7g: Always use `<Image>`, never a raw `<img>` (C-455)

`Image` (`packages/frontend/components/src/lib/image/image.svelte`) is the
single source of truth for `<img>` rendering. It defaults
`crossorigin="anonymous"`, which COEP (`require-corp`) in the Tauri shell
requires for cross-origin R2/hub URLs.

```svelte
import { Image } from '$components';
<Image src={npc.avatarUrl} alt={npc.name} class="h-full w-full object-cover" />
```

`scripts/src/lib/ops/guard_image_component.ts` fails CI on any raw `<img>` in
`apps/frontend/client` or `apps/frontend/hub`. The only exception is code that
constructs an `HTMLImageElement` directly for canvas/pixel access.

---

## Quick reference

| Context | Use |
| --- | --- |
| Button | `<button class="btn btn-primary">` |
| Badge / status | `<span class="badge badge-success">` |
| Text input | `<input class="input input-bordered" />` |
| Textarea | `<textarea class="textarea textarea-bordered">` |
| Select dropdown | `<Select {options} bind:value />` |
| Modal | `<Modal bind:open title={...} actions={...}>` |
| Tabs | `GroupedTablist` or `tabs` / `tab` / `tab-active` classes |
| Card | `card` + `card-body` / `card-title` / `card-actions` |
| Colors | `bg-base-100` / `text-primary` / `border-base-300` |
| Opacity | `bg-primary/50` |
| Adding a token | `aikami_theme.css` (`--ui-*` + `@theme`) |
| Adding a primitive class | `aikami_ui.css` |

---

## Related skills

| Skill | Covers |
| --- | --- |
| `svelte-conventions` | Runes, Views/ViewModels, `$services` |
| `aikami-conventions` | Universal TS + monorepo rules |
| `pixijs-v8` | Game engine boundary — no `$state` in game code |
