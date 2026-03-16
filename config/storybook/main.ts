// config/storybook/main.ts
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/svelte-vite';
import type { Alias } from 'vite';
import windiCSS from 'vite-plugin-windicss';
import viteTsConfigPaths from 'vite-tsconfig-paths';

const directory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(directory, '../../');
const libsDirectory = resolve(rootDirectory, 'libs');
export const toLibPath = (path: string) => join(libsDirectory, path);

const toViteAlias = (alias: Record<string, string>): Alias[] => {
  return Object.entries(alias).map(([find, replacement]) => {
    if (find.endsWith('/*')) {
      return {
        find: new RegExp(`^${find.replace('/*', '/(.*)')}$`),
        replacement: replacement.replace(/\*$/, '/$1'),
      };
    }

    return {
      find: find,
      replacement: replacement,
    };
  });
};

export const getMainStorybookConfig = (
  importMetaURL: string,
  options?: {
    alias?: Record<string, string>;
    stories?: string[];
  },
): StorybookConfig => {
  const { alias, stories } = options ?? {};
  const projectDirectory = resolve(dirname(fileURLToPath(importMetaURL)), '..');

  const mainStorybookConfig: StorybookConfig = {
    addons: ['@storybook/addon-essentials', '@storybook/addon-interactions'],
    core: {
      disableTelemetry: true,
    },
    framework: {
      name: '@storybook/svelte-vite',
      options: {},
    },
    stories: stories ?? [join(projectDirectory, 'src/**/*.stories.@(ts|mdx)')],
    typescript: {
      check: false,
    },
    managerHead: (head) => `
    	${head}
    	<link rel="shortcut icon" type="image/png" href="https://app.mailvideo.com/pwa-512x512.png" />
	`,
    viteFinal(viteConfig) {
      viteConfig.optimizeDeps = {
        ...viteConfig.optimizeDeps,
        include: [...(viteConfig.optimizeDeps?.include ?? [])],
      };
      viteConfig.plugins = [
        ...(viteConfig.plugins ?? []),
        windiCSS({
          config: resolve(projectDirectory, 'windi.config.ts'),
        }),
        viteTsConfigPaths({
          root: projectDirectory,
        }),
      ];

      viteConfig.server = {
        ...viteConfig.server,
        fs: {
          ...viteConfig.server?.fs,
          allow: [...(viteConfig.server?.fs?.allow ?? []), rootDirectory],
        },
      };

      viteConfig.resolve = {
        ...(viteConfig.resolve ?? {}),
        alias: toViteAlias({
          $i18n: toLibPath('mailvideo/frontend/i18n/src'),
          '$i18n/*': toLibPath('mailvideo/frontend/i18n/src'),
          $router: toLibPath('shared/frontend/services/src/lib/router/router-utils'),
          $routes: toLibPath('shared/frontend/services/src/lib/router/routes'),
          $services: toLibPath('mailvideo/frontend/pwa/services/src/mocks'),
          '@mailvideo/constants': toLibPath('mailvideo/constants/src'),
          '@mailvideo/frontend/components': toLibPath('mailvideo/frontend/components/src'),
          '@mailvideo/frontend/repositories': toLibPath('mailvideo/frontend/repositories/src'),
          '@mailvideo/frontend/services': toLibPath('mailvideo/frontend/services/src/lib'),
          '@mailvideo/frontend/utils': toLibPath('mailvideo/frontend/utils/src'),
          '@mailvideo/frontend/video/add': toLibPath('mailvideo/frontend/video/add/src'),
          '@mailvideo/frontend/video/library': toLibPath('mailvideo/frontend/video/library/src'),
          '@mailvideo/frontend/video/move': toLibPath('mailvideo/frontend/video/move/src'),
          '@mailvideo/frontend/video/recorder': toLibPath('mailvideo/frontend/video/recorder/src'),
          '@mailvideo/mocks': toLibPath('mailvideo/mocks/src'),
          '@mailvideo/player': toLibPath('mailvideo/frontend/video/player/src'),
          '@mailvideo/pwa/analytics-dialog': toLibPath(
            'mailvideo/frontend/pwa/analytics-dialog/src',
          ),
          '@mailvideo/pwa/components': toLibPath('mailvideo/frontend/pwa/components/src'),
          '@mailvideo/pwa/editor': toLibPath('mailvideo/frontend/pwa/editor/src'),
          '@mailvideo/pwa/notes': toLibPath('mailvideo/frontend/pwa/notes/src'),
          '@mailvideo/schemas': toLibPath('mailvideo/schemas/src'),
          '@mailvideo/types': toLibPath('mailvideo/types/src'),
          '@mailvideo/utils': toLibPath('mailvideo/utils/src'),
          '@shared/constants': toLibPath('shared/constants/src'),
          '@shared/frontend/services/*': toLibPath('shared/frontend/services/src/lib/*'),
          '@shared/frontend/services': toLibPath('shared/frontend/services/src'),
          '@shared/frontend/test': toLibPath('shared/frontend/test/src'),
          '@shared/frontend/utils': toLibPath('shared/frontend/utils/src'),
          '@shared/logger': toLibPath('shared/utils/src/lib/logger/logger-basic'),
          '@shared/mocks': toLibPath('shared/mocks/src'),
          '@shared/schemas': toLibPath('shared/schemas/src'),
          '@shared/svelte': toLibPath('shared/frontend/svelte/src'),
          '@shared/svelte-kit': toLibPath('shared/frontend/svelte-kit/src'),
          '@shared/table': toLibPath('shared/frontend/table/src'),
          '@shared/types': toLibPath('libs/shared/types/src'),
          '@shared/utils': toLibPath('shared/utils/src'),
          ...(alias ?? {}),
        }),
      };
      console.log('ALIAS:', viteConfig.resolve?.alias);

      viteConfig.define = {
        ...(viteConfig.define ?? {}),
        'process.env.NODE_DEBUG': false,
      };

      return viteConfig;
    },
  };
  return mainStorybookConfig;
};

export const getMailVideoStorybookConfig = (importMetaURL: string): StorybookConfig => {
  return getMainStorybookConfig(importMetaURL, {
    alias: {
      $routes: toLibPath('shared/frontend/services/src/lib/router/routes'),
      $services: toLibPath('mailvideo/frontend/services/src/mocks'),
    },
  });
};

export const getMailVideoPWAStorybookConfig = (importMetaURL: string): StorybookConfig => {
  return getMainStorybookConfig(importMetaURL, {
    alias: {
      $routes: toLibPath('mailvideo/frontend/pwa/services/src/lib/router/routes'),
      $services: toLibPath('mailvideo/frontend/pwa/services/src/mocks'),
    },
  });
};
