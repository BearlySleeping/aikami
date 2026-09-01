---
name: aikami-site
description: >-
  🔴 LOAD BEFORE writing ANY Aikami marketing site code — Views/Sections
  architecture, Astro 7 + Tailwind CSS v4 conventions, image components,
  path aliases, E2E test requirements, and design token usage. Load
  aikami-conventions first for universal TypeScript rules.
version: 1.0.0
tags: ["aikami", "site", "astro", "tailwind", "frontend", "marketing"]
---

# Aikami Site Conventions

**Prerequisite**: load `aikami-conventions` first (logger, imports, TS
strictness, monorepo boundaries).

---

## Architecture: Views → Sections → Components

Every page follows a strict three-layer composition. Never put logic or
content directly in `src/pages/` — pages are **light route handlers only**.

```
Page (src/pages/)
  └─ View (src/lib/views/)
       └─ Sections (src/lib/components/sections/)
            └─ Components (src/lib/components/common/)
```

### Layer Rules

| Layer | Location | Responsibility |
|---|---|---|
| **Page** | `src/pages/*.astro` | Route handler. Imports `Layout` + one `View`. Sets page title/meta. |
| **View** | `src/lib/views/*.astro` | Composes sections in order. No business logic. |
| **Section** | `src/lib/components/sections/*.astro` | One semantic `<section>` per concern. May import reusable components. |
| **Component** | `src/lib/components/common/*.astro` | Reusable UI primitives (button, picture, etc.). |

### Creating a New Page

```bash
# 1. Create the view
touch src/lib/views/pricing.astro

# 2. Create sections needed
touch src/lib/components/sections/pricing_table.astro
touch src/lib/components/sections/pricing_cta.astro

# 3. Create the page
touch src/pages/pricing.astro

# 4. Add E2E tests
# → apps/e2e/tests/site/site_pages.spec.ts (add page to PAGES array)

# 5. Validate
bun run typecheck && bun run build
```

### Section Template

```astro
---
// apps/frontend/site/src/lib/components/sections/my_section.astro
import Button from '$components/common/button.astro';
---

<section id="my-section" class="border-b border-border/70">
  <div class="mx-auto max-w-6xl px-6 py-24 md:py-28">
    <div class="max-w-2xl">
      <span class="eyebrow">Label</span>
      <h2 class="mt-5 font-serif text-4xl md:text-5xl leading-tight">
        Section heading.
      </h2>
      <p class="mt-5 text-muted-foreground leading-relaxed">
        Section description.
      </p>
    </div>
    <!-- content -->
  </div>
</section>
```

### View Template

```astro
---
// apps/frontend/site/src/lib/views/my_view.astro
import HeroSection from '$sections/my_hero.astro';
import ContentSection from '$sections/my_content.astro';
---

<HeroSection />
<ContentSection />
```

### Page Template

```astro
---
// apps/frontend/site/src/pages/my_page.astro
import Layout from '$layouts/layout.astro';
import MyView from '$views/my_view.astro';
---

<Layout title="Page Title | Aikami" description="SEO description.">
  <MyView />
</Layout>
```

## Path Aliases — 🔴 ALWAYS Use These

Never use relative imports outside the same directory. All imports must go
through the path aliases defined in `tsconfig.json`:

| Alias | Resolves to | When to use |
|---|---|---|
| `$layouts/*` | `src/lib/layouts/*` | BaseLayout |
| `$views/*` | `src/lib/views/*` | Page-level views |
| `$sections/*` | `src/lib/components/sections/*` | Section components |
| `$components/*` | `src/lib/components/*` | Any component under `components/` |
| `$data/*` | `src/lib/data/*` | `site_content.ts` |
| `$styles/*` | `src/lib/styles/*` | `global.css` (only imported once in layout) |
| `$assets/*` | `src/lib/assets/*` | Static assets (rarely imported directly) |

```astro
// ✅ CORRECT
import Layout from '$layouts/layout.astro';
import HeroSection from '$sections/hero.astro';
import Button from '$components/common/button.astro';
import { site } from '$data/site_content';

// ❌ WRONG — relative imports across directories
import Layout from '../layouts/layout.astro';
import Button from '../../components/common/button.astro';
```

## Image Components — 🔴 ALWAYS Use These

**Never use raw `<img>` tags.** Always use one of the two approved image
components. Both provide automatic AVIF/WebP format selection, responsive
`srcset`, lazy loading, and CLS-safe dimensions.

### `picture.astro` — For Static Images

Use when you have a pre-imported Astro `ImageMetadata` object:

```astro
---
import Picture from '$components/common/picture.astro';
import myImage from '$assets/hero.avif';
---

<Picture
  src={myImage}
  alt="Description"
  width={800}
  height={600}
  class="rounded-sm"
/>
```

### `dynamic_image.astro` — For Glob-Loaded Images

Use when images are resolved at build time from the `src/lib/assets/` directory:

```astro
---
import DynamicImage from '$components/common/dynamic_image.astro';
---

<DynamicImage
  imagePath="logo.avif"
  altText="Aikami logo"
  width={200}
  eager   <!-- optional: load immediately (hero images) -->
/>
```

The `imagePath` is relative to `src/lib/assets/`. The component uses
`import.meta.glob` to discover all images at build time.

### Rules

- Every `<img>` must have `alt` (can be empty `""` for decorative)
- Every `<img>` must have explicit `width` and `height` (CLS prevention)
- Below-fold images get `loading="lazy"` (default in both components)
- Hero/ATF images get `eager` (set `eager` prop or `loading="eager"`)

## Styling — Tailwind CSS v4 + Design Tokens

### 🔴 Use Semantic Tokens, Never Raw Values

```astro
<!-- ✅ CORRECT — semantic tokens -->
<section class="bg-card text-foreground border border-border">
<h2 class="text-foreground font-serif">
<a class="text-brand hover:text-foreground">

<!-- ❌ WRONG — raw colors / values -->
<section class="bg-[#1e293b] text-white">
<h2 class="text-[#c49b29]">
<a class="text-purple-500">
```

### Available Tokens

| Token | Role |
|---|---|
| `bg-background` | Page background |
| `bg-card` | Card/surface background |
| `text-foreground` | Primary text |
| `text-muted-foreground` | Secondary/body text |
| `border-border` | Borders, dividers |
| `bg-primary` / `text-primary-foreground` | Primary CTA buttons |
| `bg-secondary` / `text-secondary-foreground` | Secondary buttons |
| `text-brand` / `bg-brand` | Accent color (purple) |

### Typography

| Purpose | Class |
|---|---|
| Headings (h1, h2, h3) | `font-serif` (Instrument Serif) |
| Body text | `font-sans` (Inter) — applied by default |
| Code, labels, stats | `font-mono` (JetBrains Mono) |
| Section labels | `eyebrow` (10px mono uppercase) |
| Logo | `font-logo` |

### Layout

| Pattern | Class |
|---|---|
| Max-width container | `mx-auto max-w-6xl px-6` |
| Section padding | `py-24 md:py-28` |
| Flex gap | `gap-4` / `gap-6` / `gap-8` |
| Grid (2 columns) | `grid md:grid-cols-2 gap-px` |

### Theme

Site supports light + dark mode via `.dark` class on `<html>`. The
anti-FOUC script in `head.astro` sets it before first paint. All tokens
have light and dark variants defined in `global.css`. Design with both
themes in mind.

### Global Styles

`src/lib/styles/global.css` contains:
- Font imports (self-hosted via Fontsource)
- CSS custom properties for all design tokens
- Light + dark theme definitions
- Base element styles (body, headings, selection)
- Utility classes: `.eyebrow`, `.grain`, `.tabnum`

**Only add styles here** that are truly global or token definitions.
Component-specific styles go inline via Tailwind utilities.

## Site Data

`src/lib/data/site_content.ts` is the single source of truth for:

- `site` — name, URL, description, author, socials, themeColor, keywords
- `siteContent.nav` — navigation links array
- `siteContent.footer` — footer links

Import it from `$data/site_content`. All SEO components (head, socials,
schema, favicons) consume this data. Update it to change branding site-wide.

## Content Collections

Defined in `src/content.config.ts`:

- **Blog**: `src/content/blog/*.mdx` — title, description, date, tags, slug, author, image
- **FAQ**: `src/content/faq/*.mdx` — question, category, audience, order

Add new entries as `.mdx` files. The Zod schemas validate frontmatter.
Content is queried via `getCollection('blog')` / `getCollection('faq')`.

## Testing — 🔴 Always Write Tests

**Every new page, UX change, or visual change must include E2E tests.**

Tests live in `apps/e2e/tests/site/`. Run with:

```bash
cd apps/e2e && bun run test:site
```

### Test Files

| File | When to add |
|---|---|
| `site_pages.spec.ts` | New page → add to `PAGES` array |
| `site_seo.spec.ts` | New page → add to `SEO_PAGES` array |
| `site_accessibility.spec.ts` | New page → add to `A11Y_PAGES` array |
| `site_performance.spec.ts` | New page → add to `PERF_PAGES` array |
| `site_responsive.spec.ts` | New interactive element → add test case |

### Test Checklist for New Pages

1. Add page path + expected title to `PAGES` array in `site_pages.spec.ts`
2. Add to `SEO_PAGES` in `site_seo.spec.ts`
3. Add to `A11Y_PAGES` in `site_accessibility.spec.ts`
4. Add to `PERF_PAGES` in `site_performance.spec.ts`
5. Verify responsive behavior at desktop + mobile breakpoints

## Performance & Quality Gates

Run before submitting changes:

```bash
# Typecheck
bun run typecheck          # must pass (0 errors)

# Build
bun run build              # must pass (no warnings)

# Lighthouse
bun run unlighthouse       # performance + a11y audit

# E2E tests
cd ../e2e && bun run test:site
```

## Deployment

`scripts/deploy.ts` delegates to the shared Cloudflare deploy CLI helper
(`deployCloudflareApp('site')`, see `scripts/src/lib/deploy/cloudflare.ts`).
The site is deployed to a Cloudflare Worker with security headers (HSTS,
CSP, COOP, nosniff). Cache headers are set for immutable assets (`_astro/`
→ 1 year) and static files (images/fonts → 30 days).

```bash
# Deploy via moon
bun moon run site:deploy

# Or directly
AIKAMI_MODE=staging bun run deploy
```

## Scripts

| Script | Purpose |
|---|---|
| `scripts/convert_logo_png_to_svg.ts` | Raster PNG → vector SVG |
| `scripts/generate_public_assets.ts` | Favicons, PWA icons, OG image, webmanifest |
| `scripts/launch_chromium.ts` | Open site in Chromium app window |

## Conventions Checklist

- [ ] Pages are light route handlers (wrap Layout + View only)
- [ ] Views compose sections — no HTML directly in Views beyond section tags
- [ ] Sections use semantic `<section>` elements with Tailwind classes
- [ ] All imports use `$` path aliases (never `../` across directories)
- [ ] Images use `picture.astro` or `dynamic_image.astro` (never raw `<img>`)
- [ ] All `<img>` have `alt` + `width` + `height`
- [ ] Colors use semantic tokens (`text-foreground`, `bg-card`, etc.)
- [ ] New pages have E2E tests added to all 5 spec files
- [ ] `typecheck` passes (0 errors) + `build` passes (no warnings)
- [ ] File path comment is line 1 of every `.astro` file
- [ ] Frontmatter `---` fences are properly opened and closed
- [ ] Biased toward `snake_case` file names
