import { textToImage } from '@huggingface/inference';
import {
	parseOptionsFromArguments,
	huggingFaceAccessToken,
	writeFile,
	openFile,
} from '$utils';

const clientOptions = parseOptionsFromArguments(process.argv);

const blob = await textToImage({
	accessToken: huggingFaceAccessToken,
	inputs: 'elf',
	model: 'nerijs/pixel-art-xl',
	parameters: {
		negative_prompt: 'blurry',
	},
});

const filePath = await writeFile({
	data: blob,
	type: 'image',
	modelName: 'stabilityai/stable-diffusion-2',
	clientOptions,
});

if (!clientOptions) {
	await openFile({ filePath });
}
