import { join, resolve } from 'node:path';
import { mailvideoTheme } from './windi.colors';

const tailwindGlobPattern = '/**/!(*.test).{html,svelte,ts}';

const sizes = [
  'auto',
  'px',
  'full',
  'screen',
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
  '1.5',
  '32',
  '44',
  '72',
  '80',
];

const range = (length: number, startAt = 1) => {
  return [...Array.from({ length }).keys()].map((index) => index + startAt);
};

const colorsToClassNames = () => {
  const output: string[] = [];
  type ColorKey = keyof typeof mailvideoTheme;

  for (const [key, colorValue] of Object.entries(mailvideoTheme)) {
    const colorKey = key as ColorKey;
    if (typeof colorValue === 'string') {
      output.push(key);
    } else {
      for (const variant of Object.keys(colorValue)) {
        output.push(`${colorKey}-${variant}`);
      }
    }
  }

  return output;
};

export const getSizeSafeList = (name: string): string[] => {
  const numberPattern = range(20).map((index) => `${name}-${index}`);
  const sizesPattern = sizes.map((size) => `${name}-${size}`);
  const pattern = [...numberPattern, ...sizesPattern];

  return pattern;
};

export const getColorSafeList = (name: string): string[] => {
  return colorsToClassNames().map((size) => `${name}-${size}`);
};

const rootDirectory = resolve(__dirname, '../../');

export const getIncludePatterns = (
  directoryPath: string,
  projectsToInclude: string[],
  fileGlobPattern = tailwindGlobPattern,
): string[] => {
  const globPatternsForDependenciesLocal: string[] = [];
  // const globPatternsForDependenciesLocal =
  // 	createGlobPatternsForDependenciesLocal(directoryPath, fileGlobPattern);
  // if (globPatternsForDependenciesLocal.length === 0) {
  for (const projectToInclude of projectsToInclude) {
    globPatternsForDependenciesLocal.push(
      join(rootDirectory, projectToInclude, 'src', fileGlobPattern),
    );
  }
  // }
  const patterns = [
    ...globPatternsForDependenciesLocal,
    join(directoryPath, 'src', fileGlobPattern),
  ];
  // console.log('getIncludePatterns:', patterns);
  return patterns;
};
