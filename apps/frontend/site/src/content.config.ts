// apps/frontend/site/src/content.config.ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blogCollection = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()),
    seoKeyword: z.string().optional(),
    slug: z.string(),
    author: z.string().optional().default('Aikami Team'),
    image: z.string().optional(),
  }),
});

const faqCollection = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/faq' }),
  schema: z.object({
    question: z.string(),
    category: z.string(),
    audience: z.string().optional(),
    order: z.number().default(99),
  }),
});

export const collections = {
  blog: blogCollection,
  faq: faqCollection,
};
