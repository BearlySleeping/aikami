import { defineConfig } from '@snorreks/firestack';

export default defineConfig({
  modes: {
    development: 'my-project-dev',
    production: 'my-project-prod',
  },
  region: 'us-central1',
  functionsDirectory: 'src/controllers',
  rulesDirectory: 'src/rules',
  scriptsDirectory: 'scripts',
  initScript: 'on_emulate.ts',
  nodeVersion: '22',
  engine: 'bun',
  packageManager: 'global',
  minify: true,
  sourcemap: true,
  includeFilePath: 'src/logger.ts',
  emulators: ['auth', 'firestore', 'functions', 'pubsub', 'storage'],
});
