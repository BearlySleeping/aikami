// @ts-check

import starlight from '@astrojs/starlight';
import { defineConfig, passthroughImageService } from 'astro/config';

import { PORTS } from '../../../packages/shared/constants/src/index';

const monorepoRoot = new URL('../../..', import.meta.url).pathname;
const port = Number(process.env.PORT || PORTS.emulator.client + 10 || 5284);

/**
 * Canonical URL per mode, required by Starlight's built-in sitemap
 * integration (it warns and skips the sitemap when `site` is unset).
 *
 * The docs site is not part of the release pipeline and has no provisioned
 * domain yet, so all modes use the local URL — publishing canonical URLs for
 * unavailable hosts would be worse than none. Replace these once a domain
 * exists.
 */
const SITE_URL_MAP: Record<string, string> = {
  production: `http://localhost:${port}`,
  staging: `http://localhost:${port}`,
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
  const modeFlagIndex = argv.indexOf('--mode');
  const cliMode = modeFlagIndex !== -1 ? argv[modeFlagIndex + 1] : undefined;
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
      title: 'My Docs',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/withastro/starlight',
        },
      ],
      sidebar: [
        {
          label: 'Guides',
          items: [
            // Each item here is one entry in the navigation menu.
            { label: 'Example Guide', slug: 'guides/example' },
          ],
        },
        {
          label: 'Reference',
          items: [{ autogenerate: { directory: 'reference' } }],
        },
      ],
    }),
  ],

  vite: {
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
