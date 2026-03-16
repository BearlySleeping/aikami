// config/storybook/preview.ts
import 'virtual:windi.css';
import { loadAndSetLocale } from '@shared/frontend/test';
import type { Preview } from '@storybook/svelte';
import theme from './theme';

loadAndSetLocale();

export const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    backgrounds: {
      default: 'light',
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    docs: {
      theme,
    },
    layout: 'fullscreen',
  },
};
