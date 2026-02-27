import plugin from 'windicss/plugin';
import type { FullConfig } from 'windicss/types/interfaces';
import { createThemes, mailvideoTheme } from './windi.colors';
import { getColorSafeList, getIncludePatterns, getSizeSafeList } from './windi.utils';

export const getWindiConfig = (directoryPath: string, projectsToInclude?: string[]): FullConfig => {
  return {
    darkMode: 'class',
    plugins: [
      createThemes(),
      plugin(({ addBase }) => {
        addBase({
          '.primary-svg-gradient stop:nth-child(1)': {
            'stop-color': 'rgb(var(--theme-primary-400))',
          },
          '.primary-svg-gradient stop:nth-child(2)': {
            'stop-color': 'rgb(var(--theme-primary-700))',
          },
          '.pseudo:before, .pseudo:after': {
            content: 'attr(x)',
          },
          '.two-lines': {
            'line-height': '1.3',
            '-webkit-box-orient': 'vertical',
            '-webkit-line-clamp': '2',
            display: '-webkit-box',
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'word-break': 'break-word',
          },
          'input:-webkit-autofill, input :-webkit-autofill:focus': {
            transition: 'background-color 600000s 0s, color 600000s 0s',
          },
          'input[data-autocompleted]': {
            'background-color': 'transparent !important',
          },
        });
      }),
    ],

    safelist: [
      getSizeSafeList('w'),
      getSizeSafeList('h'),
      getColorSafeList('text'),
      getColorSafeList('bg'),
      getColorSafeList('border'),
    ],

    theme: {
      colors: mailvideoTheme,
      extend: {
        backgroundImage: {
          gradient: 'linear-gradient(123deg, #428CFB 6.87%, #0537DB 90.53%)',
        },
        backgroundSize: {
          full: '100% 100%',
        },
        boxShadow: {
          btn: '0 3px 1px -2px rgba(0,0,0,.2),0 2px 2px 0 rgba(0,0,0,.14),0 1px 5px 0 rgba(0,0,0,.12)',
          dialog:
            '0 11px 15px -7px rgba(0,0,0,.2), 0 24px 38px 3px rgba(0,0,0,.14), 0 9px 46px 8px rgba(0,0,0,.12)',
          search: '0 0 6rem 4rem white',
        },
        fontSize: {
          xxs: '10px',
        },
        gridTemplateColumns: {
          features: 'repeat(auto-fit,minmax(224px,1fr))',
        },
        letterSpacing: {
          tight: '-.0125rem',
        },
        maxWidth: {
          container: '1156px',
        },
        scale: {
          200: '2.0',
        },
        spacing: {
          '14px': '14px',
          '3px': '3px',
          7.5: '1.875rem',
        },
        transitionProperty: {
          drawer: 'transform, width, padding, visibility',
        },
        zIndex: {
          above_intercom: 2_147_483_002 + 1,
          below: -1,
          dropdown: 10,
          fixed: 40,
          fixed_overlay: 30,
          modal: 60,
          modal_overlay: 50,
          popover: 70,
          toolbar: 20,
          tooltip: 80,
        },
      },
    },
    extract: {
      include: getIncludePatterns(directoryPath, projectsToInclude ?? []),
    },
  };
};
