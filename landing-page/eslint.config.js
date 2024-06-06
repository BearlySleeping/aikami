import eslintPluginAstro from 'eslint-plugin-astro';
import tailwind from 'eslint-plugin-tailwindcss';
import ts from 'typescript-eslint';

/**
 * @type {import('eslint').Linter.Config}
 */
export default [
	...ts.configs.recommended,
	...eslintPluginAstro.configs.recommended,
	...tailwind.configs['flat/recommended'],
];
