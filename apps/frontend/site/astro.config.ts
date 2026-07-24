// apps/frontend/site/astro.config.ts
/** biome-ignore-all lint/style/useNamingConvention: We are setting environment variables to uppercase */

import type { Mode } from '@aikami/types';
import mdx from '@astrojs/mdx';
import partytown from '@astrojs/partytown';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField } from 'astro/config';
import compress from 'astro-compress';
import robotsTxt from 'astro-robots-txt';

const mode = (process.env.AIKAMI_MODE || process.env.MODE || 'emulator') as Mode;

const PORT_MAP: Record<string, number> = {
  production: 5281,
  staging: 5279,
  emulator: 5280,
};
const port = Number(process.env.PORT || PORT_MAP[mode] || 5280);

const SITE_URL_MAP: Record<string, string> = {
  production: 'https://aikami.dev',
  staging: 'https://stg.aikami.dev',
  emulator: `http://localhost:${port}`,
};
const site =
  process.env.SITE_URL ||
  process.env.PUBLIC_SITE_URL ||
  SITE_URL_MAP[mode] ||
  `http://localhost:${port}`;

// https://astro.build/config
export default defineConfig({
  output: 'static',
  server: {
    port,
  },
  env: {
    schema: {
      PUBLIC_GOOGLE_ANALYTICS_ID: envField.string({
        context: 'client',
        access: 'public',
        optional: false,
        default: '',
      }),
      PUBLIC_MICROSOFT_CLARITY_ID: envField.string({
        context: 'client',
        access: 'public',
        optional: false,
        default: '',
      }),
      PUBLIC_FIREBASE_API_KEY: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      PUBLIC_FIREBASE_AUTH_DOMAIN: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      PUBLIC_FIREBASE_STORAGE_BUCKET: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      PUBLIC_FIREBASE_MESSAGING_SENDER_ID: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      PUBLIC_FIREBASE_APP_ID: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      PUBLIC_RECAPTCHA_SITE_KEY: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      PUBLIC_APP_CHECK_DEBUG_TOKEN: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      PUBLIC_DISABLE_APP_CHECK: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      PUBLIC_MODE: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      PUBLIC_SITE_URL: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
    },
  },

  site: site,
  integrations: [
    mdx(),
    robotsTxt({
      sitemap: true,
      policy: [
        {
          userAgent: '*',
          allow: '/',
          disallow: ['/404', '/~partytown/'],
        },
      ],
    }),
    compress({
      Image: false,
      SVG: true,
      HTML: {
        'html-minifier-terser': {
          removeComments: false,
          collapseWhitespace: false,
          removeAttributeQuotes: false,
          removeEmptyAttributes: false,
          removeScriptTypeAttributes: true,
          removeStyleLinkTypeAttributes: true,
        },
      },
    }),
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en-US' },
      },
      changefreq: 'weekly',
      priority: 1,
      namespaces: {
        news: false,
        video: false,
        image: false,
        xhtml: true,
      },
    }),
    partytown({
      config: {
        forward: ['dataLayer.push', 'gtag', 'clarity'],
      },
    }),
  ],

  vite: {
    // biome-ignore lint/suspicious/noExplicitAny: Vite version mismatch in monorepo
    plugins: [tailwindcss()] as any[],
  },
});
