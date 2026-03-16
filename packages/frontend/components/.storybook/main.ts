// packages/frontend/components/.storybook/main.ts

import { resolve } from 'node:path';
import type { StorybookConfig } from '@storybook/svelte-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.{svelte,ts}'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-essentials', '@storybook/addon-interactions'],
  framework: {
    name: '@storybook/svelte-vite',
    options: {},
  },
  typescript: {
    check: false,
  },
  async viteFinal(viteConfig) {
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: {
        ...viteConfig.resolve?.alias,
        $lib: resolve(__dirname, '../src'),
        '$lib/*': resolve(__dirname, '../src/*'),
      },
    };
    return viteConfig;
  },
};

export default config;
