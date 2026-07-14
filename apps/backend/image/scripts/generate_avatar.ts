// apps/backend/image/scripts/generate_avatar.ts
// biome-ignore-all lint/style/useNamingConvention: Property names must match ComfyUI API field names (snake_case and PascalCase)
// Submit a txt2img prompt to the ComfyUI API and retrieve the output.
//
// Usage:
//   bun run scripts/generate_avatar.ts                          # default prompt
//   bun run scripts/generate_avatar.ts "a knight in armor"      # custom prompt
//   bun run scripts/generate_avatar.ts --steps 20 --cfg 7.5     # tuning

import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const COMFYUI = 'http://localhost:8188';

// ── Configuration ────────────────────────────────────────────────────────

type GenerationOptions = {
	prompt: string;
	negativePrompt: string;
	width: number;
	height: number;
	steps: number;
	cfg: number;
	seed: number;
	checkpoint: string;
};

/**
 * Parse CLI arguments into generation options.
 */
const parseOptions = (): GenerationOptions => {
	const args = process.argv.slice(2);
	const prompt = args.find((a) => !a.startsWith('--')) ?? '';

	const getArg = (flag: string, fallback: string): string => {
		const idx = args.indexOf(flag);
		return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
	};

	return {
		prompt:
			prompt ||
			'pixel art, 1girl, warrior, leather armor, sword, dynamic pose, vibrant colors, RPG character sprite, masterpiece, best quality',
		negativePrompt:
			getArg('--negative', '') ||
			'lowres, bad anatomy, bad hands, text, error, missing fingers, cropped, worst quality, low quality, blurry',
		width: parseInt(getArg('--width', '512'), 10),
		height: parseInt(getArg('--height', '512'), 10),
		steps: parseInt(getArg('--steps', '20'), 10),
		cfg: parseFloat(getArg('--cfg', '7')),
		seed: parseInt(getArg('--seed', String(Math.floor(Math.random() * 99999999999))), 10),
		checkpoint: getArg('--checkpoint', 'pixel-art/illustriousPixelart_v6SeriesV60.safetensors'),
	};
};

// ── Workflow Builder ─────────────────────────────────────────────────────

/**
 * Build a minimal txt2img workflow for ComfyUI.
 *
 * Node IDs:
 *   1 — CheckpointLoaderSimple
 *   2 — CLIPTextEncode (positive)
 *   3 — CLIPTextEncode (negative)
 *   4 — EmptyLatentImage
 *   5 — KSampler
 *   6 — VAEDecode
 *   7 — SaveImage
 */
type ComfyUIWorkflow = Record<string, unknown>;

const buildWorkflow = (options: GenerationOptions): ComfyUIWorkflow => ({
	'1': {
		inputs: { ckpt_name: options.checkpoint },
		class_type: 'CheckpointLoaderSimple',
	},
	'2': {
		inputs: { text: options.prompt, clip: ['1', 1] },
		class_type: 'CLIPTextEncode',
	},
	'3': {
		inputs: { text: options.negativePrompt, clip: ['1', 1] },
		class_type: 'CLIPTextEncode',
	},
	'4': {
		inputs: { width: options.width, height: options.height, batch_size: 1 },
		class_type: 'EmptyLatentImage',
	},
	'5': {
		inputs: {
			seed: options.seed,
			steps: options.steps,
			cfg: options.cfg,
			sampler_name: 'euler',
			scheduler: 'normal',
			denoise: 1,
			model: ['1', 0],
			positive: ['2', 0],
			negative: ['3', 0],
			latent_image: ['4', 0],
		},
		class_type: 'KSampler',
	},
	'6': {
		inputs: { samples: ['5', 0], vae: ['1', 2] },
		class_type: 'VAEDecode',
	},
	'7': {
		inputs: { images: ['6', 0], filename_prefix: 'aikami_avatar' },
		class_type: 'SaveImage',
	},
});

// ── API Helpers ──────────────────────────────────────────────────────────

/**
 * Submit a workflow and return the prompt ID.
 */
const queuePrompt = async (workflow: ComfyUIWorkflow): Promise<string> => {
	const body = JSON.stringify({ prompt: workflow });
	const response = await fetch(`${COMFYUI}/api/prompt`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body,
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Failed to queue prompt: ${response.status} — ${text}`);
	}

	const data = await response.json();
	if (!data.prompt_id) {
		throw new Error('No prompt_id in response');
	}

	return data.prompt_id as string;
};

/**
 * Poll the history endpoint until the prompt completes.
 */
type HistoryOutput = {
	filename: string;
	subfolder: string;
	type: string;
};

type HistoryEntry = {
	outputs: Record<
		string,
		{ images: HistoryOutput[] }
	>;
	status: {
		status_str: string;
		completed: boolean;
	};
};

const waitForCompletion = async (promptId: string): Promise<HistoryEntry> => {
	const url = `${COMFYUI}/api/history/${promptId}`;

	for (let i = 0; i < 120; i++) {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			throw new Error(`History fetch failed: ${response.status}`);
		}

		const data = (await response.json()) as Record<string, HistoryEntry>;
		const entry = data[promptId];

		if (entry) {
			const status = entry.status?.status_str ?? 'unknown';
			if (entry.status?.completed) {
				return entry;
			}

			// Progress indicator
			process.stdout.write(`\r  Status: ${status} (${i + 1}s)`);

			// Check for errors
			if (status === 'error') {
				throw new Error('Generation failed — check ComfyUI logs');
			}
		}

		await new Promise((r) => setTimeout(r, 1000));
	}

	throw new Error('Generation timed out after 120s');
};

/**
 * Download an output image from ComfyUI.
 */
const downloadImage = async (output: HistoryOutput, outputDir: string): Promise<string> => {
	const params = new URLSearchParams({
		filename: output.filename,
		subfolder: output.subfolder,
		type: output.type,
	});

	const response = await fetch(`${COMFYUI}/api/view?${params}`, {
		signal: AbortSignal.timeout(30_000),
	});

	if (!response.ok) {
		throw new Error(`Failed to download image: ${response.status}`);
	}

	const destDir = resolve(import.meta.dirname, '../src/output', outputDir);
	mkdirSync(destDir, { recursive: true });

	const destPath = resolve(destDir, output.filename);
	await Bun.write(destPath, response);

	return destPath;
};

// ── Main ─────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
	const options = parseOptions();

	console.log('🎨 ComfyUI Avatar Generator\n');
	console.log(`  Prompt:   ${options.prompt}`);
	console.log(`  Negative: ${options.negativePrompt}`);
	console.log(`  Size:     ${options.width}×${options.height}`);
	console.log(`  Steps:    ${options.steps}  CFG: ${options.cfg}`);
	console.log(`  Seed:     ${options.seed}`);
	console.log(`  Model:    ${options.checkpoint}`);
	console.log();

	// ── Submit workflow ───────────────────────────────
	process.stdout.write('  Submitting...');
	const workflow = buildWorkflow(options);
	const promptId = await queuePrompt(workflow);
	process.stdout.write(` prompt_id=${promptId}\n`);

	// ── Wait for completion ────────────────────────────
	console.log('  Generating...');
	const history = await waitForCompletion(promptId);
	process.stdout.write('\n');

	// ── Download output ────────────────────────────────
	const outputs = history.outputs;
	const outputNodes = Object.keys(outputs);

	if (outputNodes.length === 0) {
		console.error('✗ No output images found');
		process.exit(1);
	}

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	let totalBytes = 0;

	for (const nodeId of outputNodes) {
		const images = outputs[nodeId].images;
		for (const img of images) {
			const path = await downloadImage(img, timestamp);
			const size = statSync(path).size;
			totalBytes += size;
			console.log(`✓ ${img.filename}  ${(size / 1024).toFixed(1)}KB`);
		}
	}

	console.log(`\nSaved to: src/output/${timestamp}/`);
	console.log(`Total:    ${(totalBytes / 1024).toFixed(1)}KB`);
	console.log(`Seed:     ${options.seed}  (reuse with --seed ${options.seed})`);
};

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`\n✗ ${message}`);
	process.exit(1);
});
