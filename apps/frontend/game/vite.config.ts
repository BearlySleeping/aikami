import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { Mode } from '@aikami/types';
import { defineConfig } from 'vite';
import { PORTS } from '../../../packages/shared/constants/src/index';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(projectDirectory, '../../..');

const packagesDirectory = join(rootDirectory, 'packages');

/**
 * Get the absolute path from the root directory
 *
 * @param path Relative path
 * @returns Absolute path
 */
const toPackagesPath = (path: string) => join(packagesDirectory, path);
/**
 * Get the absolute path from the src folder in the project directory
 *
 * @param path Relative path
 * @returns Absolute path
 */
const toSrcPath = (path: string) => join(projectDirectory, 'src', path);

export default defineConfig(({ mode }) => {
  const port = Number(process.env.PORT || PORTS[mode as Mode].game);

  return {
    envPrefix: ['PUBLIC_'],
    resolve: {
      alias: {
        $lib: toSrcPath('lib'),
        $logger: toSrcPath('lib/core/logger.ts'),
        $services: toSrcPath('lib/services'),
        $types: toSrcPath('lib/types'),

        '@aikami/constants': toPackagesPath('shared/constants/src'),
        '@aikami/mocks': toPackagesPath('shared/mocks/src'),
        '@aikami/schemas': toPackagesPath('shared/schemas/src'),
        '@aikami/types': toPackagesPath('shared/types/src'),
        '@aikami/utils': toPackagesPath('shared/utils/src'),
        '@aikami/frontend/engine': toPackagesPath('frontend/engine/src'),
        '@aikami/logger': toPackagesPath('shared/logger/src'),

        '@aikami/frontend/configs/environment': toPackagesPath(
          'frontend/configs/src/lib/environment.ts',
        ),
        '@aikami/frontend/utils': toPackagesPath('frontend/utils/src'),
      },
    },
    server: {
      fs: {
        allow: [rootDirectory],
      },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      port,
      watch: {
        ignored: ['**/examples/**', '**/docs/**', '**/dist/**', '**/.svelte-kit/**', '**/.pi/**'],
      },
    },
    preview: {
      port,
    },
    build: {
      outDir: 'dist',
    },
  };
});
