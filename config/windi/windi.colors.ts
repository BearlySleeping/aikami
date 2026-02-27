import {
  type ColorHex,
  type ColorShades,
  type ThemePalette,
  themeable,
} from 'tailwindcss-themeable';

// TODO: check how use colors for vscode auto-completion in tailwind.config.cjs

export interface ThemeScheme {
  attention: ColorHex;
  neutral: ColorShades;
  primary: ColorShades;
  drawer: ColorHex;
  overlay: ColorHex;
  accent: ColorHex;
  'accent-lighten': ColorHex;
  'accent-darken': ColorHex;
  text: ColorHex;
  'text-grey': ColorHex;
  'text-lighten': ColorHex;
  warning: ColorHex;
  'warning-lighten': ColorHex;
  'warning-darken': ColorHex;
  surface: ColorHex;
}

export const mailvideoTheme: ThemePalette = {
  accent: '#24c38e',
  'accent-darken': '#1a8b65',
  'accent-lighten': '#9aecd1',
  attention: '#fac905',
  drawer: '#ebf0f4',
  neutral: {
    100: '#e4e8ef',
    200: '#c9d2de',
    300: '#afbbce',
    400: '#94a4be',
    50: '#f5f7fc',
    500: '#798dad',
    600: '#5f779c',
    700: '#435470',
    800: '#303b4e',
    900: '#181e27',
    DEFAULT: '#798dad',
  },
  overlay: '#141f30',
  primary: {
    100: '#d4e5fd',
    200: '#a9cafa',
    300: '#7db0f9',
    400: '#5295f7',
    50: '#ecf4ff',
    500: '#277bfa',
    600: '#1f57d4',
    700: '#123a8d',
    800: '#061d47',
    900: '#03112c',
    DEFAULT: '#277bfa',
  },
  surface: '#ffffff',
  text: '#141f30',
  'text-grey': '#737d8c',
  'text-lighten': '#3b5377',
  warning: '#ef4444',
  'warning-darken': '#f87171',
  'warning-lighten': '#fecaca',
};

export const superofficeTheme: ThemePalette = {
  ...mailvideoTheme,
  accent: '#11a197',
  'accent-darken': '#0c736c',
  'accent-lighten': '#30e9dc',
  drawer: '#f5f5f8',
  primary: {
    100: '#baf8f3',
    200: '#8cf3eb',
    300: '#5eeee4',
    400: '#30e9dc',
    50: '#e8fdfb',
    500: '#11a197',
    600: '#0c736c',
    700: '#074541',
    800: '#021716',
    900: '#021716',
    DEFAULT: '#0a5e58',
  },
  text: '#2b2a2a',
  warning: '#ef7545',
  'warning-darken': '#d4450d',
  'warning-lighten': '#fc8b5f',
};

export const webcrmTheme: ThemePalette = {
  ...mailvideoTheme,
  accent: '#1dc471',
  'accent-darken': '#14a56c',
  'accent-lighten': '#2ae675',
  drawer: '#ffffff',
  neutral: {
    100: '#e0e0e0',
    200: '#e0e0e0',
    300: '#e0e0e0',
    400: '#bdbdbd',
    50: '#ffffff',
    500: '#9e9e9e',
    600: '#757575',
    700: '#616161',
    800: '#424242',
    900: '#212121',
    DEFAULT: '#757575',
  },
  primary: {
    100: '#ebf1fe',
    200: '#afcfff',
    300: '#86b2fc',
    400: '#6898fb',
    50: '#f0f3fa',
    500: '#3971f7',
    600: '#3971f7',
    700: '#1c3fb2',
    800: '#102c8f',
    900: '#0a1d78',
    DEFAULT: '#3971f7',
  },
  surface: '#f5f8fa',
  text: '#212121',
  warning: '#e54839',
  'warning-darken': '#d50000',
  'warning-lighten': '#f27a60',
};

export const trumpetTheme: ThemePalette = {
  accent: '#413cc3',
  'accent-darken': '#3935ab',
  'accent-lighten': '#8885d9',
  attention: '#fac905',
  drawer: '#f7f7f8',
  neutral: {
    100: '#e4e8ef',
    200: '#E0E0E0',
    300: '#afbbce',
    400: '#C1C0D5',
    50: '#f5f7fc',
    500: '#798dad',
    600: '#5f779c',
    700: '#435470',
    800: '#303b4e',
    900: '#181e27',
    DEFAULT: '#798dad',
  },
  overlay: '#505050',
  primary: {
    100: '#fcc8d1',
    200: '#fa9cac',
    300: '#f88699',
    400: '#f65a74',
    50: '#fddee3',
    500: '#f54966',
    600: '#e70d31',
    700: '#a50923',
    800: '#630515',
    900: '#37030c',
    DEFAULT: '#f54966',
  },
  surface: '#ffffff',
  text: '#18171c',
  'text-grey': '#9191a1',
  'text-lighten': '#9191a1',
  warning: '#ef4444',
  'warning-darken': '#f87171',
  'warning-lighten': '#fecaca',
};

export const themes = [
  {
    name: 'superoffice',
    palette: superofficeTheme,
  },
  {
    name: 'mailvideo',
    palette: mailvideoTheme,
  },
  {
    name: 'webcrm',
    palette: webcrmTheme,
  },
  {
    name: 'trumpet',
    palette: trumpetTheme,
  },
];

export const createThemes = () =>
  themeable({
    classPrefix: 'theme',
    defaultTheme: 'mailvideo',
    themes,
  });
