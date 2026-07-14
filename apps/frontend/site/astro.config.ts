import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, passthroughImageService } from 'astro/config';
import icon from 'astro-icon';

const monorepoRoot = new URL('../../..', import.meta.url).pathname;

// https://astro.build/config
export default defineConfig({
  integrations: [
    sitemap(),
    icon({
      iconDir: 'src/assets/icons',
    }),
  ],
  image: {
    service: passthroughImageService(),
  },
  vite: {
    // biome-ignore lint/suspicious/noExplicitAny: see https://github.com/tailwindlabs/tailwindcss/issues/18802
    plugins: [tailwindcss() as any],
    server: {
      fs: {
        // Allow Vite to serve files from the monorepo root
        // (This fixes the ".../dev-toolbar/entrypoint.js" error)
        allow: [monorepoRoot],
      },
    },
  },
});
