import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { CLIOptions } from '$types';

type AIType = 'image' | 'text' | 'voice';

const basePath = 'output';

/**
 * Writes data to a file in a specified directory, ensuring that the directory exists and generating a unique file name.
 * @param options - The options object containing data and configuration for writing the file.
 * @param options.data - The Blob of data to be written to the file. This is the content of the file.
 * @param options.type - The type of AI generating the content. Used for categorizing or processing the data appropriately.
 * @param options.modelName - Optional. The name of the model used for generating the data. This can be used for naming or organizational purposes.
 * @param options.fileExtension - Optional. The desired file extension for the written file. If not provided, a default should be used based on the data type or context.
 * @returns The file path where the data was written, as a string. This allows the caller to know where the file is located and access it if needed.
 */
export const writeFile = async (options: {
	data: Blob;
	type: AIType;
	modelName?: string;
	fileExtension?: string;
	clientOptions?: CLIOptions;
}): Promise<string> => {
	const { data } = options;
	const outputDirectory = getOutputDirectory(options);
	await ensureDirectoryExists(outputDirectory);
	const fileName = getUniqueFileName(options);
	const filePath = `${outputDirectory}/${fileName}`;
	await Bun.write(filePath, data);
	return filePath;
};

/**
 * Open an image with the default image viewer.
 * @param filePath The path to the file to open.
 */
export const openFile = async (options: {
	filePath: string;
}): Promise<void> => {
	const { filePath } = options;
	try {
		const commandPrefix = getOpenFileCommandPrefix();

		await $`${commandPrefix} ${filePath} &`;
	} catch (error) {
		console.error('Could not open the file', error);
	}
};

export const getOpenFileCommandPrefix = (): string => {
	switch (process.platform) {
		case 'win32':
			return 'start';
		case 'darwin':
			return 'open';
		case 'linux':
			return 'xdg-open';
		default:
			throw new Error('Unsupported platform');
	}
};

const getOutputDirectory = (options: {
	type: AIType;
	modelName?: string;
}): string => {
	const { type } = options;
	let modelName = options.modelName;
	let path = `${basePath}/${type}`;
	if (modelName) {
		// convert model name so it is a valid directory name, aka it cannot have /
		modelName = modelName.replace(/\//g, '_');
		path = `${path}/${modelName}`;
	}
	return path;
};

const getUniqueFileName = (options: {
	type: AIType;
	fileExtension?: string;
}): string => {
	const extension =
		options.fileExtension || getDefaultFileExtension(options.type);
	const timestamp = Date.now();
	return `${timestamp}${extension}`;
};

const getDefaultFileExtension = (type: AIType): string => {
	switch (type) {
		case 'image':
			return '.jpg';
		case 'text':
			return '.txt';
		case 'voice':
			return '.mp3';
		default:
			throw new Error('Invalid type');
	}
};

const ensureDirectoryExists = async (dir: string): Promise<void> => {
	if (!existsSync(dir)) {
		await mkdir(dir, { recursive: true });
	}
};
