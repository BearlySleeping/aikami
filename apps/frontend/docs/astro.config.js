'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
// @ts-check
var config_1 = require('astro/config');
var starlight_1 = require('@astrojs/starlight');
var monorepoRoot = new URL('../../..', import.meta.url).pathname;
// https://astro.build/config
exports.default = (0, config_1.defineConfig)({
  image: {
    service: (0, config_1.passthroughImageService)(),
  },
  integrations: [
    (0, starlight_1.default)({
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
          autogenerate: { directory: 'reference' },
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
    },
  },
});
