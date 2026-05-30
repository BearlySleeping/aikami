import { defineConfig } from 'vite';

const port = Number(process.env.PORT || 5174);

export default defineConfig({
  root: '.',
  server: {
    port,
  },
  preview: {
    port,
  },
  build: {
    outDir: 'dist',
  },
});
