import adapter from '@sveltejs/adapter-auto'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = dirname(fileURLToPath(import.meta.url))
const packagesDirectory = resolve(projectDirectory, '../../../packages')
/**
 * Get the absolute path from the root directory
 *
 * @param {string} path Relative path
 * @returns {string} Absolute path
 */
const toPackagesPath = (path) => join(packagesDirectory, path)
/**
 * Get the absolute path from the src folder in the project directory
 *
 * @param {string} path Relative path
 * @returns {string} Absolute path
 */
const toSrcPath = (path) => join(projectDirectory, 'src', path)

const config = {
  preprocess: [vitePreprocess()],
  extensions: ['.svelte', '.svx'],
  kit: {
    adapter: adapter(),
    alias: {
      '$components/*': toSrcPath('lib/components/*'),
      $i18n: toSrcPath('lib/client/utils/i18n'),
      $lib: toPackagesPath('lib'),
      '$lib/*': toSrcPath('lib/*'),
      $router: toPackagesPath(
        'frontend/services/src/lib/router/router-utils',
      ),
      $routes: toSrcPath('lib/constants/routes'),
      '$logger': toPackagesPath(
        'logger/src/lib/svelte-kit.ts',
      ),
      $services: toSrcPath('lib/client/services'),
      '$services/*': toSrcPath('lib/services/*'),

      $types: toSrcPath('lib/types'),
      $utils: toSrcPath('lib/utils'),
      '$utils/*': toSrcPath('lib/utils/*'),
      '$views/*': toSrcPath('lib/views/*'),

      '@aikami/backend/svelte-kit/*': toPackagesPath('backend/svelte-kit/src/lib/*'),
      '@aikami/backend/database/*': toPackagesPath('backend/database/src/lib/*'),
      '@aikami/backend/auth/*': toPackagesPath('backend/auth/src/lib/*'),
      '@aikami/backend/ai/*': toPackagesPath('backend/ai/src/lib/*'),
      '@aikami/backend/utils/*': toPackagesPath('backend/utils/src/lib/*'),
      '@aikami/backend/configs/*': toPackagesPath('backend/configs/src/lib/*'),

      '@aikami/backend/svelte-kit': toPackagesPath('backend/svelte-kit/src'),
      '@aikami/backend/database': toPackagesPath('backend/database/src'),
      '@aikami/backend/auth': toPackagesPath('backend/auth/src'),
      '@aikami/backend/ai': toPackagesPath('backend/ai/src'),
      '@aikami/backend/utils': toPackagesPath('backend/utils/src'),
      '@aikami/backend/configs': toPackagesPath('backend/configs/src'),

      '@aikami/constants': toPackagesPath('constants/src'),
      '@aikami/frontend/services': toPackagesPath(
        'frontend/services/src',
      ),
      '@aikami/frontend/services/*': toPackagesPath(
        'frontend/services/src/lib',
      ),
      '@aikami/frontend/test': toPackagesPath('frontend/test/src'),
      '@aikami/frontend/utils': toPackagesPath('frontend/utils/src'),
      '@aikami/frontend/utils/*': toPackagesPath(
        'frontend/utils/src/lib',
      ),
      '@aikami/frontend/repositories': toPackagesPath('frontend/repositories/src'),
      '@aikami/frontend/repositories/*': toPackagesPath(
        'frontend/repositories/src/lib',
      ),

      '@aikami/mocks': toPackagesPath('mocks/src'),
      '@aikami/schemas': toPackagesPath('schemas/src'),
      '@aikami/table': toPackagesPath('frontend/table/src'),
      '@aikami/types': toPackagesPath('types/src'),
      '@aikami/utils': toPackagesPath('utils/src'),
    },
  },
}

export default config
