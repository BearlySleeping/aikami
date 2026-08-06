// @ts-check

import starlight from '@astrojs/starlight';
import { defineConfig, passthroughImageService } from 'astro/config';

import { PORTS } from '../../../packages/shared/constants/src/index';

const monorepoRoot = new URL('../../..', import.meta.url).pathname;
const port = Number(process.env.PORT || PORTS.emulator.client + 10 || 5284);

// Canonical URL per mode, required by Starlight's built-in sitemap
// integration (it warns and skips the sitemap when `site` is unset). The
// docs domain is not provisioned yet — update once the site is deployed.
const SITE_URL_MAP: Record<string, string> = {
  production: 'https://docs.bearlysleeping.com',
  staging: 'https://stg-docs.bearlysleeping.com',
  emulator: `http://localhost:${port}`,
};
const mode = (process.env.AIKAMI_MODE || process.env.MODE || 'emulator') as string;
const site = SITE_URL_MAP[mode] ?? SITE_URL_MAP.emulator;

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
