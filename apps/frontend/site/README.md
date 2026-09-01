# Aikami Site

Public marketing site for [Aikami](https://aikami.dev) — an AI-powered 2D RPG.
Built with **Astro 7** + **Tailwind CSS v4**, deployed to **Cloudflare Workers**.

## Quick Start

```bash
# From repo root
cd apps/frontend/site

# Install dependencies (first time only)
bun install

# Start dev server (emulator mode, port 5280)
bun run dev

# Other modes
bun run dev:staging      # staging backend
bun run dev:production    # production backend
```

Or via moon:
```bash
bun moon run site:dev
```

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Dev server (emulator, port 5280) |
| `bun run build` | Production build → `dist/` |
| `bun run preview` | Preview production build locally |
| `bun run typecheck` | `astro sync && astro check` |
| `bun run lint` / `fix` | Biome linting / auto-fix |
| `bun run deploy` | Deploy to Cloudflare Workers (via `scripts/deploy.ts`) |
| `bun run preview:chromium` | Open site in Chromium app window |
| `bun run unlighthouse` | Full Lighthouse audit (build + analyze) |

### Mode-specific builds

```bash
bun run build:emulator      # emulator-mode build
bun run build:staging       # staging build
bun run build:production    # production build
```

## Deployment

Deployment is handled by `scripts/deploy.ts`, which reads the current mode from `AIKAMI_MODE` (or `MODE`) and deploys to Cloudflare Workers.

```bash
# Deploy to staging
AIKAMI_MODE=staging bun run deploy

# Or pass mode explicitly
bun run scripts/deploy.ts -- --mode staging
```

The script delegates to the shared Cloudflare deploy helper in `scripts/src/lib/deploy/cloudflare.ts`, which handles argument parsing, app config resolution, and deployment invocation.

## Architecture

```
src/
├── pages/                  → Light route handlers (one per URL)
│   └── index.astro         → Wraps Layout + HomeView
├── content.config.ts       → Content collections (blog, faq)
├── content/                → MDX content files
│   ├── blog/
│   └── faq/
└── lib/
    ├── layouts/            → BaseLayout (Head, Navbar, Footer)
    │   └── layout.astro
    ├── views/              → Page-level view compositions
    │   └── home.astro      → HomeView (composes sections)
    ├── components/
    │   ├── common/         → Shared reusable components
    │   │   ├── button.astro
    │   │   ├── dynamic_image.astro
    │   │   └── picture.astro
    │   ├── sections/       → Page sections (hero, features, etc.)
    │   │   ├── hero.astro
    │   │   ├── features.astro
    │   │   ├── demo.astro
    │   │   └── backlog.astro
    │   ├── layout/         → Shell components
    │   │   ├── navbar.astro
    │   │   ├── footer.astro
    │   │   └── head/       → SEO head fragments
    │   └── meta/           → Analytics scripts (GA, Clarity)
    ├── data/               → Site branding / content config
    │   └── site_content.ts
    └── styles/             → Global CSS + design tokens
        └── global.css
```

## How to Add a New Page

1. **Create the View** in `src/lib/views/`

```astro
---
// src/lib/views/pricing.astro
import CTASection from '$sections/cta.astro';
import PricingSection from '$sections/pricing.astro';
---

<PricingSection />
<CTASection />
```

2. **Create Sections** in `src/lib/components/sections/`

```astro
---
// src/lib/components/sections/pricing.astro
import Button from '$components/common/button.astro';
---

<section id="pricing" class="border-b border-border/70">
  <div class="mx-auto max-w-6xl px-6 py-24">
    <h2 class="font-serif text-4xl">Pricing</h2>
    <!-- ... -->
  </div>
</section>
```

3. **Create the Page** in `src/pages/`

```astro
---
// src/pages/pricing.astro
import Layout from '$layouts/layout.astro';
import PricingView from '$views/pricing.astro';
---

<Layout title="Pricing | Aikami">
  <PricingView />
</Layout>
```

4. **Add E2E tests** in `apps/e2e/tests/site/`
5. **Run validation**: `bun run typecheck && bun run build`

## Path Aliases

Always use `$` aliases — never relative imports outside the same directory:

| Alias | Resolves to |
|---|---|
| `$layouts/*` | `src/lib/layouts/*` |
| `$views/*` | `src/lib/views/*` |
| `$sections/*` | `src/lib/components/sections/*` |
| `$components/*` | `src/lib/components/*` |
| `$styles/*` | `src/lib/styles/*` |
| `$data/*` | `src/lib/data/*` |
| `$assets/*` | `src/lib/assets/*` |

## Images

**Always use `picture.astro` or `dynamic_image.astro`** — never raw `<img>` tags:

```astro
<!-- Static image -->
import Picture from '$components/common/picture.astro';
<Picture src={image} alt="Description" width={800} />

<!-- Dynamic image (glob-loaded from assets) -->
import DynamicImage from '$components/common/dynamic_image.astro';
<DynamicImage imagePath="logo.avif" altText="Aikami logo" width={200} />
```

Both components provide:
- Automatic AVIF/WebP format selection
- Responsive `srcset` generation
- Lazy loading (default) or eager loading
- Proper `width`/`height` for CLS prevention

## Styling

Global styles live in `src/lib/styles/global.css`:
- **Design tokens**: CSS custom properties (colors, fonts, radii, shadows)
- **Light + dark theme**: Via `.dark` class on `<html>`
- **Utility classes**: `.eyebrow`, `.grain`, `.tabnum`
- **Base styles**: Font smoothing, selection colors, heading fonts

Component-level styles use **Tailwind CSS v4** utility classes inline.
Follow Tailwind best practices:
- Use semantic color tokens (`text-foreground`, `bg-card`, `border-border`) — never raw hex values
- Use design-system spacing and typography utilities
- Prefer `class` over inline `style` attributes

## Testing

Site E2E tests live in `apps/e2e/tests/site/`:

```bash
# Run all site tests (Chromium + Mobile)
cd apps/e2e && bun run test:site

# Accessibility only
bun run test:site:a11y

# Visual regression
bun run test:site:visual
```

**Always add tests** for new pages, UX changes, or visual changes:

| Test file | What it covers |
|---|---|
| `site_pages.spec.ts` | Page rendering, navigation, layout |
| `site_seo.spec.ts` | Meta tags, structured data, sitemap, headings |
| `site_accessibility.spec.ts` | WCAG 2.1 AA via axe-core |
| `site_performance.spec.ts` | Load times, render-blocking, cache |
| `site_responsive.spec.ts` | Mobile menu, viewport breakpoints |

## Content Collections

Content is managed via Astro content collections (`src/content.config.ts`):

- **Blog**: `src/content/blog/*.mdx`
- **FAQ**: `src/content/faq/*.mdx`

Each collection has a Zod schema for frontmatter validation. Query with `getCollection()`.

## Performance Audits

```bash
# Full Lighthouse audit
bun run unlighthouse

# Quick preview + Chromium
bun run preview:chromium
```

## Generating Public Assets

Brand assets (favicons, PWA icons, OG images, webmanifest) are generated from
the canonical `assets/default.webp` at the repo root. The unified script produces
assets for all frontends (`client`, `site`, `docs`) in one pass.

```bash
# From repo root:
bun run scripts/src/lib/ops/generate_brand_assets.ts

# Skip slow PNG→SVG tracing (use existing assets/default.svg):
bun run scripts/src/lib/ops/generate_brand_assets.ts --skip-svg

# Convert image → SVG only (PNG or WebP input):
bun run scripts/src/lib/ops/convert_image_to_svg.ts
```

## Security Headers

Security headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Cache-Control) are configured in the Cloudflare Worker deployment config.

## Environment Variables

Defined in `astro.config.ts` env schema:

| Variable | Context | Required |
|---|---|---|
| `PUBLIC_GOOGLE_ANALYTICS_ID` | client | No (default: `""`) |
| `PUBLIC_MICROSOFT_CLARITY_ID` | client | No (default: `""`) |
| `PUBLIC_SITE_URL` | client | No |
| `PUBLIC_CLOUDFLARE_*` | client | No |
| `PUBLIC_RECAPTCHA_SITE_KEY` | client | No |
| `PUBLIC_MODE` | client | No |
