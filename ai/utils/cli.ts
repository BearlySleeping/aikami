import type { CLIOptions } from '$types';

export const parseOptionsFromArguments = (
	args: string[],
): CLIOptions | undefined => {
	// Find the index of the '--options' argument
	const optionsIndex = args.indexOf('--options');
	if (optionsIndex === -1) {
		return;
	}
	const options = args[optionsIndex + 1];
	if (!options) {
		return;
	}
	// Check if '--options' is found and has a following value
	try {
		// Attempt to parse the JSON string following '--options'
		const parsed_options = JSON.parse(options);
		return parsed_options;
	} catch (error) {
		// Handle or log the error if JSON parsing fails
		console.error('Error parsing options:', error);
		return;
	}
};
