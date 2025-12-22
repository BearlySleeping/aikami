import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'
import icon from 'astro-icon'
import { defineConfig, passthroughImageService } from 'astro/config'

import tailwindcss from '@tailwindcss/vite'
const monorepoRoot = new URL('../../..', import.meta.url).pathname

// https://astro.build/config
export default defineConfig({
  integrations: [
    mdx(),
    sitemap(),
    icon({
      iconDir: 'src/assets/icons',
    }),
  ],
  image: {
    service: passthroughImageService(),
  },
  vite: {
    // see https://github.com/tailwindlabs/tailwindcss/issues/18802
    // deno-lint-ignore no-explicit-any
    plugins: [tailwindcss() as any],
    server: {
      fs: {
        // Allow Vite to serve files from the monorepo root
        // (This fixes the ".../dev-toolbar/entrypoint.js" error)
        allow: [monorepoRoot],
      },
    },
  },
})
