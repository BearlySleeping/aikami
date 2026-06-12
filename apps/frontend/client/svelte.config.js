// apps/frontend/client/svelte.config.js
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const packagesDirectory = resolve(projectDirectory, '../../../packages');
/**
 * Get the absolute path from the root directory
 *
 * @param {string} path Relative path
 * @returns {string} Absolute path
 */
const toPackagesPath = (path) => join(packagesDirectory, path);
/**
 * Get the absolute path from the src folder in the project directory
 *
 * @param {string} path Relative path
 * @returns {string} Absolute path
 */
const toSrcPath = (path) => join(projectDirectory, 'src', path);

const config = {
  preprocess: [vitePreprocess()],
  kit: {
    adapter: adapter({
      fallback: 'index.html',
      pages: 'build',
    }),
    prerender: {
      handleUnseenRoutes: 'ignore',
    },
    alias: {
      '$components/*': toSrcPath('lib/components/*'),
      $i18n: toSrcPath('lib/utils/i18n'),
      $lib: toPackagesPath('lib'),
      '$lib/*': toSrcPath('lib/*'),
      $router: toPackagesPath('frontend/services/src/lib/router/router_utils'),
      $routes: toSrcPath('lib/constants/routes'),
      $logger: toPackagesPath('shared/logger/src/lib/svelte_kit.ts'),
      $loggerServer: toPackagesPath('shared/logger/src/lib/svelte_kit_server.ts'),
      $services: toSrcPath('lib/services'),
      '$services/*': toSrcPath('lib/services/*'),

      $types: toSrcPath('lib/types'),
      $utils: toSrcPath('lib/utils'),
      '$utils/*': toSrcPath('lib/utils/*'),
      '$views/*': toSrcPath('lib/views/*'),

      '@aikami/backend/svelte-kit/*': toPackagesPath('backend/svelte-kit/src/lib/*'),
      '@aikami/backend/database': toPackagesPath('backend/database/src'),
      '@aikami/backend/database/*': toPackagesPath('backend/database/src/lib/*'),
      '@aikami/backend/auth/*': toPackagesPath('backend/auth/src/lib/*'),
      '@aikami/backend/onboarding': toPackagesPath('backend/onboarding/src'),
      '@aikami/backend/agent': toPackagesPath('backend/agent/src'),
      '@aikami/backend/chat': toPackagesPath('backend/chat/src'),
      '@aikami/backend/knowledge': toPackagesPath('backend/knowledge/src'),
      '@aikami/backend/team': toPackagesPath('backend/team/src'),
      '@aikami/backend/admin': toPackagesPath('backend/admin/src'),
      '@aikami/backend/utils/*': toPackagesPath('backend/utils/src/lib/*'),
      '@aikami/backend/configs/*': toPackagesPath('backend/configs/src/lib/*'),

      '@aikami/constants': toPackagesPath('shared/constants/src'),
      '@aikami/frontend/services': toPackagesPath('frontend/services/src'),
      '@aikami/frontend/services/*': toPackagesPath('frontend/services/src/lib'),
      '@aikami/frontend/components': toPackagesPath('frontend/components/src'),
      '@aikami/frontend/components/*': toPackagesPath('frontend/components/src/lib/*'),

      '@aikami/frontend/dataconnect': toPackagesPath('frontend/dataconnect/src'),
      '@aikami/frontend/dataconnect/*': toPackagesPath('frontend/dataconnect/src/lib/*'),

      '@aikami/frontend/configs': toPackagesPath('frontend/configs/src'),
      '@aikami/frontend/configs/*': toPackagesPath('frontend/configs/src/lib'),
      '@aikami/frontend/engine': toPackagesPath('frontend/engine/src'),
      '@aikami/frontend/engine/*': toPackagesPath('frontend/engine/src/*'),
      '@aikami/frontend/svelte-kit': toPackagesPath('frontend/svelte-kit/src'),
      '@aikami/frontend-svelte-kit/*': toPackagesPath('frontend/svelte-kit/src/lib/*'),

      '@aikami/frontend/test': toPackagesPath('frontend/test/src'),
      '@aikami/frontend/utils': toPackagesPath('frontend/utils/src'),
      '@aikami/frontend/utils/*': toPackagesPath('frontend/utils/src/lib'),
      '@aikami/frontend/repositories': toPackagesPath('frontend/repositories/src'),
      '@aikami/frontend/repositories/*': toPackagesPath('frontend/repositories/src/lib'),
      '@aikami/frontend/api-core': toPackagesPath('frontend/api-core/src'),
      '@aikami/frontend/api-core/*': toPackagesPath('frontend/api-core/src/lib'),

      '@aikami/mocks': toPackagesPath('shared/mocks/src'),
      '@aikami/schemas': toPackagesPath('shared/schemas/src'),
      '@aikami/table': toPackagesPath('frontend/table/src'),
      '@aikami/types': toPackagesPath('shared/types/src'),
      '@aikami/utils': toPackagesPath('shared/utils/src'),
    },
  },
};

export default config;
