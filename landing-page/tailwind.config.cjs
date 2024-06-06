// tailwind.config.js
module.exports = {
	content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
	theme: {
		extend: {
			colors: {
				primary: {
					DEFAULT: '#4a5568', // Neutral primary color
					dark: '#2d3748', // Dark variant
				},
				secondary: {
					DEFAULT: '#718096', // Neutral secondary color
					dark: '#4a5568', // Dark variant
				},
				accent: {
					DEFAULT: '#a0aec0', // Neutral accent color
					dark: '#718096', // Dark variant
				},
				background: {
					DEFAULT: '#edf2f7', // Light mode background color
					dark: '#1a202c', // Dark mode background color
				},
				text: {
					DEFAULT: '#2d3748', // Light mode text color
					dark: '#e2e8f0', // Dark mode text color
				},
			},
		},
	},
	darkMode: ['class', '.darkmode'], // Enable dark mode
	plugins: [],
};
