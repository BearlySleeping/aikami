import { addons } from '@storybook/manager-api';
import theme from './theme';

// https://storybook.js.org/docs/react/configure/features-and-behavior
addons.setConfig({
  enableShortcuts: true,
  initialActive: 'sidebar',
  isFullscreen: false,
  // cspell:disable-next-line
  isToolshown: true,
  panelPosition: 'bottom',
  selectedPanel: undefined,
  showNav: true,
  showPanel: true,
  sidebar: {
    collapsedRoots: ['other'],
    showRoots: false,
  },
  theme,
  toolbar: {
    copy: { hidden: false },
    eject: { hidden: false },
    fullscreen: { hidden: false },
    title: { hidden: false },
    zoom: { hidden: false },
  },
});

export { addons };
