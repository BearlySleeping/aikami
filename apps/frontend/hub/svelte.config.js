// apps/frontend/hub/svelte.config.js
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from 'svelte-adapter-bun';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const packagesDirectory = resolve(projectDirectory, '../../../packages');
const toPackagesPath = (path) => join(packagesDirectory, path);
const toSrcPath = (path) => join(projectDirectory, 'src', path);

const config = {
  preprocess: [vitePreprocess()],
  compilerOptions: {
    warningFilter: (warning) => warning.code !== 'state_referenced_locally',
  },
  kit: {
    adapter: adapter({
      out: 'build',
    }),
    alias: {
      $components: toSrcPath('lib/components'),
      '$components/*': toSrcPath('lib/components/*'),
      $lib: toPackagesPath('lib'),
      '$lib/*': toSrcPath('lib/*'),
      $logger: toPackagesPath('shared/logger/src/lib/svelte_kit.ts'),
      $loggerServer: toPackagesPath('shared/logger/src/lib/log_context_backend.ts'),
      '$logger/*': toPackagesPath('shared/logger/src/*'),
      $router: toPackagesPath('frontend/services/src/lib/router/router_utils'),
      $routes: toSrcPath('lib/constants/routes'),
      $services: toSrcPath('lib/client/services'),
      '$services/*': toSrcPath('lib/client/services/*'),
      $types: toSrcPath('lib/types'),
      $utils: toSrcPath('lib/utils'),
      '$views/*': toSrcPath('lib/views/*'),

      '@aikami/backend/svelte-kit/*': toPackagesPath('backend/svelte-kit/src/lib/*'),
      '@aikami/backend/firestore/*': toPackagesPath('backend/firestore/src/lib/*'),
      '@aikami/backend/utils/*': toPackagesPath('backend/utils/src/lib/*'),
      '@aikami/backend/configs/*': toPackagesPath('backend/configs/src/lib/*'),

      '@aikami/constants': toPackagesPath('shared/constants/src'),
      '@aikami/frontend/services': toPackagesPath('frontend/services/src'),
      '@aikami/frontend/services/*': toPackagesPath('frontend/services/src/lib'),
      '@aikami/logger': toPackagesPath('shared/logger/src'),

      '@aikami/frontend/components': toPackagesPath('frontend/components/src'),
      '@aikami/frontend/components/*': toPackagesPath('frontend/components/src/lib/*'),

      '@aikami/frontend/configs': toPackagesPath('frontend/configs/src'),
      '@aikami/frontend/configs/*': toPackagesPath('frontend/configs/src/lib'),
      '@aikami/frontend/dataconnect': toPackagesPath('frontend/dataconnect/src'),
      '@aikami/frontend/dataconnect/*': toPackagesPath('frontend/dataconnect/src/lib'),
      '@aikami/frontend/utils': toPackagesPath('frontend/utils/src'),
      '@aikami/frontend/utils/*': toPackagesPath('frontend/utils/src/lib'),
      '@aikami/frontend/firestore': toPackagesPath('frontend/firestore/src'),
      '@aikami/frontend/firestore/*': toPackagesPath('frontend/firestore/src/lib'),
      '@aikami/frontend/storage': toPackagesPath('frontend/storage/src'),
      '@aikami/frontend/storage/*': toPackagesPath('frontend/storage/src/lib'),

      '@aikami/schemas': toPackagesPath('shared/schemas/src'),
      '@aikami/types': toPackagesPath('shared/types/src'),
      '@aikami/utils': toPackagesPath('shared/utils/src'),
    },
  },
};

export default config;
