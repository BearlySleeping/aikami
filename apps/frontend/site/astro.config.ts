// apps/frontend/site/astro.config.ts
/** biome-ignore-all lint/style/useNamingConvention: We are setting environment variables to uppercase */

import { fileURLToPath } from 'node:url';
import type { Mode } from '@aikami/types';
import mdx from '@astrojs/mdx';
import partytown from '@astrojs/partytown';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField } from 'astro/config';
import compress from 'astro-compress';
import robotsTxt from 'astro-robots-txt';
import { loadEnv } from 'vite';

import { PORTS } from '../../../packages/shared/constants/src/index';

/**
 * Resolve the Astro build mode.
 *
 * Priority: CLI `--mode <mode>` flag (either `--mode production` or
 * `--mode=production`; e.g. `astro build --mode production`, or
 * `moon run site:build -- --mode staging` via bun passthrough) > ambient env
 * (AIKAMI_MODE / MODE, set by direnv or the deploy pipeline) > 'emulator'.
 *
 * The CLI flag must win: astro.config.ts is evaluated before Astro loads any
 * `.env.*` file into `process.env`, so relying on process.env alone meant the
 * ambient direnv value (AIKAMI_MODE=emulator) leaked into production builds
 * and produced the wrong canonical URL (https://stg.bearlysleeping.com).
 *
 * The candidate is validated against the known PORTS keys before being
 * returned, so `PORTS[_mode]` below can never index an unknown mode.
 */
function resolveMode(): Mode {
  const argv = process.argv;
  // Support both `--mode <value>` and `--mode=<value>` CLI forms.
  let cliMode: string | undefined;
  const modeFlagIndex = argv.indexOf('--mode');
  if (modeFlagIndex !== -1) {
    cliMode = argv[modeFlagIndex + 1];
  } else {
    cliMode = argv.find((arg) => arg.startsWith('--mode='))?.slice('--mode='.length);
  }
  const candidate = cliMode || process.env.AIKAMI_MODE || process.env.MODE || 'emulator';
  return (candidate in PORTS ? candidate : 'emulator') as Mode;
}

const _mode = resolveMode();
const port = Number(process.env.PORT || PORTS[_mode].site);

const SITE_URL_MAP: Record<string, string> = {
  production: 'https://bearlysleeping.com',
  staging: 'https://stg.bearlysleeping.com',
  emulator: `http://localhost:${port}`,
};

/**
 * Read the site URL from the mode-specific env file (`.env.{mode}`) via
 * Vite's loadEnv — `process.env` does NOT see these values during config
 * evaluation. Falls back to the mode map so a missing env file can never
 * regress the canonical URL to a staging domain.
 */
const env = loadEnv(_mode, '.', 'PUBLIC_');
const site = env.PUBLIC_SITE_URL || SITE_URL_MAP[_mode] || `http://localhost:${port}`;

// https://astro.build/config
export default defineConfig({
  output: 'static',
  server: {
    port,
  },

  env: {
    validateSecrets: true,
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
      PUBLIC_APP_ID: envField.string({
        context: 'client',
        access: 'public',
        optional: false,
        min: 1,
      }),
      PUBLIC_MODE: envField.string({
        context: 'client',
        access: 'public',
        optional: false,
        min: 1,
      }),
      PUBLIC_SITE_URL: envField.string({
        context: 'client',
        access: 'public',
        // Consumed by astro.config.ts via loadEnv — not via astro:env — so it
        // must not fail validation when empty (emulator mode uses localhost).
        optional: true,
      }),
      PUBLIC_GITHUB_REPO: envField.string({
        context: 'client',
        access: 'public',
        optional: false,
        default: '',
      }),
    },
  },

  site,
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
    resolve: {
      alias: {
        '@aikami/frontend/theme': fileURLToPath(
          new URL('../../../packages/frontend/theme/src/index.ts', import.meta.url),
        ),
        '@aikami/frontend/theme/': fileURLToPath(
          new URL('../../../packages/frontend/theme/src/lib/', import.meta.url),
        ),
      },
    },
  },
});
