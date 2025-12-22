// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config'
import starlight from '@astrojs/starlight'

const monorepoRoot = new URL('../../..', import.meta.url).pathname

// https://astro.build/config
export default defineConfig({
  image: {
    service: passthroughImageService(),
  },

  integrations: [
    starlight({
      title: 'My Docs',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/withastro/starlight' }],
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
})
