/** @type {import("prettier").Config} */
export default {
	arrowParens: 'always',
	bracketSameLine: true,
	endOfLine: 'auto',
	semi: true,
	singleQuote: true,
	tabWidth: 4,
	trailingComma: 'all',
	useTabs: true,
	printWidth: 80,
	plugins: ['prettier-plugin-tailwindcss', 'prettier-plugin-astro'],
	overrides: [
		{
			files: '*.astro',
			options: {
				parser: 'astro',
			},
		},
	],
};
