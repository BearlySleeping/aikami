---
name: astro
description: Best practices, patterns, and conventions for Astro web framework development. Includes project structure, component patterns, content collections, and integration with Svelte, React, and other frameworks.
version: 1.0.0
author: Aikami Team
tags: ["astro", "web", "ssg", "islands", "typescript", "markdown"]
---

# Astro Development Skill

This skill provides comprehensive guidelines for building Astro applications following modern best practices.

## 1. Project Structure

### Recommended Directory Structure

```
src/
├── components/
│   ├── common/           # Reusable UI components
│   ├── layouts/          # Layout components
│   └── features/         # Feature-specific components
├── content/
│   ├── config.ts        # Content collections configuration
│   └── [collection]/    # Content collections
│       ├── _index.md
│       └── *.md
├── layouts/
│   ├── BaseLayout.astro
│   └── BlogLayout.astro
├── pages/
│   ├── index.astro
│   ├── blog/
│   │   ├── index.astro
│   │   └── [slug].astro
│   └── api/
│       └── *.ts          # API endpoints
├── styles/
│   └── global.css
├── lib/
│   ├── utils.ts
│   └── constants.ts
└── env.d.ts
```

---

## 2. Configuration

### astro.config.mjs

```typescript
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://example.com',
  integrations: [
    svelte(),
    tailwind(),
    mdx(),
    sitemap(),
  ],
  output: 'static', // or 'server' / 'hybrid'
  adapter: '@astrojs/node', // for server/hybrid mode
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
});
```

---

## 3. Components

### Astro Components

```astro
---
// Props interface with JSDoc
interface Props {
  /** The page title */
  title: string;
  /** Optional description */
  description?: string;
}

const { title, description = 'Default description' } = Astro.props;
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="description" content={description} />
    <title>{title}</title>
  </head>
  <body>
    <slot /> <!-- Content slot -->
  </body>
</html>
```

### Component Props with TypeScript

```typescript
// src/components/Card.astro
interface Props {
  /** Card title */
  title: string;
  /** Card content */
  content?: string;
  /** Optional CSS class */
  class?: string;
}

const { title, content = '', class: className = '' } = Astro.props;
```

---

## 4. Framework Integrations

### Svelte Integration

```astro
---
import Counter from '../components/Counter.svelte';
---

<!-- Client-side interactive component -->
<Counter client:load />

<!-- Only render on client -->
<Counter client:only="svelte" />

<!-- Hydrate when visible -->
<Counter client:visible />
```

### Available Directives

| Directive | Description |
|-----------|-------------|
| `client:load` | Load immediately |
| `client:idle` | Load when idle |
| `client:visible` | Load when in viewport |
| `client:media` | Load when media query matches |
| `client:only` | Client-only (no SSR) |

---

## 5. Content Collections

### Configuration

```typescript
// src/content/config.ts
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
    updatedDate: z.date().optional(),
    heroImage: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
```

### Usage

```typescript
// src/pages/blog/[...slug].astro
import { getCollection } from 'astro:content';

export async function getStaticPaths() {
  const posts = await getCollection('blog');
  return posts.map((post) => ({
    params: { slug: post.slug },
    props: { post },
  }));
}

const { post } = Astro.props;
const { Content } = await post.render();
```

---

## 6. Layouts

### Base Layout

```astro
---
// src/layouts/BaseLayout.astro
interface Props {
  title: string;
  description?: string;
}

const { title, description = 'Aikami' } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <title>{title}</title>
    <meta name="description" content={description} />
  </head>
  <body>
    <slot />
  </body>
</html>
```

### Using Layouts

```astro
---
// src/pages/index.astro
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="Home">
  <h1>Welcome</h1>
</BaseLayout>
```

---

## 7. API Routes

### Server-Side API

```typescript
// src/pages/api/posts.ts
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  const data = await request.json();
  
  // Process data
  return new Response(JSON.stringify({
    success: true,
    data,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
};
```

---

## 8. Routing

### Dynamic Routes

```typescript
// src/pages/posts/[id].astro
export function getStaticPaths() {
  return [
    { params: { id: '1' }, props: { title: 'Post 1' } },
    { params: { id: '2' }, props: { title: 'Post 2' } },
  ];
}

const { id } = Astro.params;
const { title } = Astro.props;
```

### Route Parameters

```typescript
// src/pages/[lang]/[...slug].astro
export function getStaticPaths() {
  return [
    { params: { lang: 'en', slug: 'about' } },
    { params: { lang: 'es', slug: 'about' } },
  ];
}
```

---

## 9. Environment Variables

### Using .env

```typescript
// Environment variables
import { PUBLIC_API_URL } from 'astro:env/client';
import { API_SECRET } from 'astro:env/server';

// In .env
PUBLIC_API_URL=https://api.example.com
API_SECRET=secret_key
```

---

## 10. Testing

### Unit Testing Components

```bash
# Install testing dependencies
bun add -d vitest @testing-library/svelte
```

```typescript
// src/components/__tests__/Button.test.ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Button from '../Button.svelte';

describe('Button', () => {
  it('renders correctly', () => {
    const { getByRole } = render(Button, { props: { text: 'Click me' } });
    expect(getByRole('button')).toHaveTextContent('Click me');
  });
});
```

### E2E Testing with Playwright

```typescript
// tests/home.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should load successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  });
});
```

---

## 11. Build Commands

### Common Commands

```bash
# Development
bun run dev

# Build
bun run build

# Preview production build
bun run preview

# Run tests
bun run test

# Typecheck
bun run typecheck
```

---

## 12. Best Practices

### 1. Use Content Collections

Always use content collections for markdown/mdx content:

```typescript
import { getCollection } from 'astro:content';

// Type-safe content access
const posts = await getCollection('blog', ({ data }) => !data.draft);
```

### 2. Optimize Images

```astro
---
import { Image } from 'astro:assets';
import myImage from '../assets/hero.png';
---

<Image src={myImage} alt="Hero" width={800} height={400} />
```

### 3. Use Islands Wisely

```astro
<!-- Only hydrate what's needed -->
<HeavyComponent client:visible />  <!-- Good: hydrates when visible -->
<HeavyComponent client:load />      <!-- Less ideal: loads immediately -->
```

### 4. Type Everything

```typescript
// Always type props
interface Props {
  title: string;
  count?: number;
}

const { title, count = 0 } = Astro.props;
```

### 5. Use Zod for Validation

```typescript
import { z } from 'astro:content';

const schema = z.object({
  title: z.string().min(1),
  count: z.number().int().positive(),
});
```

---

## 13. Anti-Patterns to Avoid

1. ❌ Mixing static and dynamic content without clear separation
2. ❌ Using client-side only solutions when SSR would work
3. ❌ Not using content collections for markdown
4. ❌ Omitting types for component props
5. ❌ Over-using client directives (causes unnecessary JS)
6. ❌ Storing sensitive data in client-side code
7. ❌ Not optimizing images (use Image component)
