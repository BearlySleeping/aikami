// @ts-check

import { fileURLToPath } from 'node:url';

import starlight from '@astrojs/starlight';
import { defineConfig, passthroughImageService } from 'astro/config';

import { PORTS } from '../../../packages/shared/constants/src/index';

// `new URL(...).pathname` yields a leading-slash drive path (`/C:/...`) on
// Windows, which fs and Vite's fs.allow both reject. fileURLToPath converts
// correctly; the separators are normalized to posix so the alias values below
// stay platform-independent.
const monorepoRoot = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/');
const port = Number(process.env.PORT || PORTS.emulator.client + 10 || 5284);

/**
 * Canonical URL per mode, required by Starlight's built-in sitemap
 * integration (it warns and skips the sitemap when `site` is unset).
 *
 * The docs app is enabled through DEPLOYABLE_APPS in deployment_config.ts
 * (scripts/src/lib/deploy/deployment_config.ts). Production/staging hosts
 * follow the same subdomain pattern as the hub (hub.bearlysleeping.com).
 * Staging uses the custom site ID aikami-stg-docs because aikami-staging-docs
 * is reserved by an unrelated Firebase project.
 */
const SITE_URL_MAP: Record<string, string> = {
  production: 'https://docs.bearlysleeping.com',
  staging: 'https://docs.stg.bearlysleeping.com',
  emulator: `http://localhost:${port}`,
};

/**
 * Resolve the Astro build mode: CLI `--mode <mode>` wins (direnv's ambient
 * AIKAMI_MODE would otherwise leak into `astro build --mode production`),
 * then AIKAMI_MODE / MODE env, then 'emulator' for local dev. Unknown modes
 * throw instead of silently falling back to the emulator URL.
 */
function resolveMode(): string {
  const argv = process.argv;
  // Support both `--mode <value>` (used by the deploy pipeline) and
  // `--mode=<value>` (common when running the build by hand).
  const modeFlagIndex = argv.indexOf('--mode');
  const cliMode =
    modeFlagIndex !== -1
      ? argv[modeFlagIndex + 1]
      : argv.find((arg) => arg.startsWith('--mode='))?.slice('--mode='.length);
  const resolved = cliMode || process.env.AIKAMI_MODE || process.env.MODE || 'emulator';
  if (!(resolved in SITE_URL_MAP)) {
    throw new Error(
      `Unknown Astro mode "${resolved}". Valid modes: ${Object.keys(SITE_URL_MAP).join(', ')}`,
    );
  }
  return resolved;
}

const mode = resolveMode();
const site = SITE_URL_MAP[mode];

// https://astro.build/config
export default defineConfig({
  site,

  image: {
    service: passthroughImageService(),
  },

  integrations: [
    starlight({
      title: 'Aikami Docs',
      description:
        'Guides and reference for Aikami — the open-source, self-hosted AI RPG engine. Setup, AI providers, content packs, and how each system works.',
      logo: {
        src: './src/assets/logo.svg',
        alt: 'Aikami',
        replacesTitle: false,
      },
      favicon: '/favicon.svg',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/BearlySleeping/aikami',
        },
        {
          icon: 'discord',
          label: 'Discord',
          href: 'https://discord.gg/XuuhWvSxHH',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/BearlySleeping/aikami/edit/main/apps/frontend/docs/',
      },
      customCss: ['./src/styles/docs.css'],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'What is Aikami?', slug: 'index' },
            { label: 'Installation', slug: 'start/installation' },
            { label: 'Choosing your AI setup', slug: 'start/ai-setup' },
          ],
        },
        {
          label: 'Guides',
          items: [{ autogenerate: { directory: 'guides' } }],
        },
        {
          label: 'Features',
          items: [{ autogenerate: { directory: 'features' } }],
        },
      ],
    }),
  ],

  vite: {
    resolve: {
      alias: {
        '@aikami/frontend-theme': `${monorepoRoot}packages/frontend/theme/src/index.ts`,
        '@aikami/frontend-theme/': `${monorepoRoot}packages/frontend/theme/src/lib/`,
        '@aikami/frontend/theme': `${monorepoRoot}packages/frontend/theme/src/lib`,
        '@aikami/frontend/theme/*': `${monorepoRoot}packages/frontend/theme/src/lib/*`,
      },
    },
    server: {
      fs: {
        // Allow Vite to serve files from the monorepo root
        // (This fixes the ".../dev-toolbar/entrypoint.js" error)
        allow: [monorepoRoot],
      },
      port,
      strictPort: true,
    },
  },
});
