import { defineConfig } from 'vite';

const port = Number(process.env.PORT || 5174);

export default defineConfig({
  root: '.',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    port,
  },
  preview: {
    port,
  },
  build: {
    outDir: 'dist',
  },
});
