// apps/backend/image/scripts/generate_avatar.ts
/** biome-ignore-all lint/suspicious/noConsole: CLI script — console is the interface */
// Avatar generation CLI for the image dev engine (C-392).
//
// C-510: the transport moved to `@aikami/local-ai`'s `SdCppGenerationEngine`
// — this script no longer declares the `/sdcpp/v1` protocol, the job shape or
// the inline-image extractor. The CLI surface is unchanged.
//
// The default image service is sd-server (stable-diffusion.cpp) from the
// C-390 local-stack compose profile. The shared client owns the wire protocol
// (submit → poll → inline image, plus the sd-models listing used to fail fast
// on an unknown checkpoint).
//
// Generation runs on CPU and can be slow (~26s/step for a 512×512 Anima
// job), so the poll deadline defaults to 15 minutes. Pass --timeout to
// change it, e.g. --timeout 120 for a quick smoke test.
//
// Usage:
//   bun run generate:avatar "an elven ranger, pixel art"
//   bun run generate:avatar "a knight" --steps 20 --cfg 7 --seed 42 \
//     --width 512 --height 512
//   (omit --checkpoint to use the engine's loaded model; pass it to pin one)
//   (CPU generation is slow — raise --timeout if the default 900s is too short)
//
// LoRA: defaults come from IMAGE_LORA / IMAGE_LORA_STRENGTH in the
// local-stack .env (applied to every run). Override per-run:
//   bun run generate:avatar "a knight" --lora anima-pixel.safetensors --lora-strength 0.8
//   bun run generate:avatar "a knight" --lora ""   # disable the default LoRA
// LoRA strength must be between 0 and 2 (inclusive).
//
// Contract: C-392 / C-510 AC-1

import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { SdCppGenerationEngine } from '@aikami/local-ai';

const SD_SERVER = 'http://127.0.0.1:8188';

/**
 * Read the local-stack `.env` (the single source of truth for engine/model
 * selection — docker compose already reads it) so IMAGE_LORA defaults apply
 * to this CLI too. Returns an empty map if the file is missing/unreadable.
 */
const readLocalStackEnv = (): Record<string, string> => {
  const envPath = resolve(import.meta.dir, '../../local-stack/.env');
  try {
    const text = readFileSync(envPath, 'utf8');
    const vars: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
        continue;
      }
      const eq = trimmed.indexOf('=');
      vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return vars;
  } catch {
    return {};
  }
};

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
  /** LoRA file name to apply (from local-stack .env IMAGE_LORA or --lora). Empty = none. */
  lora: string;
  /** LoRA strength (from IMAGE_LORA_STRENGTH or --lora-strength). */
  loraStrength: number;
  /** Poll deadline in seconds. CPU generation is slow, so default is 900. */
  timeout: number;
};

/**
 * Parse CLI arguments into generation options. The pre-C-392 flag surface
 * (--steps/--cfg/--seed/--width/--height/--checkpoint) is preserved; the
 * default checkpoint now names the shared-store GGUF used by sd-server.
 */
const parseOptions = (): GenerationOptions => {
  const args = process.argv.slice(2);
  const prompt = args.find((a) => !a.startsWith('--')) ?? '';
  const stackEnv = readLocalStackEnv();

  const getArg = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    if (idx === -1) {
      return fallback;
    }
    const value = args[idx + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  // LoRA resolution: an explicit --lora flag wins (value 'none' or ''
  // disables it); otherwise fall back to the local-stack .env IMAGE_LORA.
  const loraIdx = args.indexOf('--lora');
  const loraArg = loraIdx === -1 ? undefined : args[loraIdx + 1];
  if (loraIdx !== -1 && (loraArg === undefined || loraArg.startsWith('--'))) {
    throw new Error('--lora requires a value; pass an empty string to disable LoRA');
  }
  const lora = loraIdx !== -1 ? (loraArg ?? '') : (stackEnv.IMAGE_LORA ?? '');
  const loraStrengthText = getArg(
    '--lora-strength',
    stackEnv.IMAGE_LORA_STRENGTH ?? process.env.IMAGE_LORA_STRENGTH ?? '0.8',
  );
  const loraStrength = Number.parseFloat(loraStrengthText);
  if (
    !Number.isFinite(loraStrength) ||
    Number(loraStrengthText) !== loraStrength ||
    loraStrength < 0 ||
    loraStrength > 2
  ) {
    throw new Error('--lora-strength must be a finite number between 0 and 2');
  }
  const timeoutText = getArg('--timeout', '900');
  const timeout = Number.parseInt(timeoutText, 10);
  if (!/^[+]?[0-9]+$/.test(timeoutText) || !Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('--timeout must be a finite positive integer');
  }

  return {
    prompt:
      prompt ||
      'pixel art, 1girl, warrior, leather armor, sword, dynamic pose, vibrant colors, RPG character sprite, masterpiece, best quality',
    negativePrompt:
      getArg('--negative', '') ||
      'lowres, bad anatomy, bad hands, text, error, missing fingers, cropped, worst quality, low quality, blurry',
    width: Number.parseInt(getArg('--width', '512'), 10),
    height: Number.parseInt(getArg('--height', '512'), 10),
    steps: Number.parseInt(getArg('--steps', '20'), 10),
    cfg: Number.parseFloat(getArg('--cfg', '7')),
    seed: Number.parseInt(getArg('--seed', String(Math.floor(Math.random() * 99999999999))), 10),
    // Empty default: sd-server uses whatever model it has loaded (e.g. the
    // Anima diffusion model). Only an explicit --checkpoint selects a model.
    checkpoint: getArg('--checkpoint', ''),
    // sd-server applies LoRAs at runtime via the img_gen `lora` field,
    // resolved against --lora-model-dir (/models/image). See the resolution above.
    lora: lora === 'none' ? '' : lora,
    loraStrength,
    // CPU inference is slow (~26s/step at 512×512); 900s covers a 20-step
    // run with headroom. Use --timeout to tighten it for quick smoke tests.
    timeout,
  };
};

// ── Output ───────────────────────────────────────────────────────────────

/** PNG magic bytes — a bad payload must fail loudly, never write garbage. */
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/**
 * Writes decoded image bytes to disk after verifying the PNG magic.
 *
 * sd-server may echo a long prompt/id under one of the scanned fields, which
 * decodes to short meaningless bytes that would otherwise be reported as
 * success.
 */
const saveImage = async (bytes: Uint8Array, outputDir: string): Promise<string> => {
  if (bytes.length < 8 || !PNG_MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new Error(
      `Decoded payload is not a PNG (${bytes.length} bytes) — sd-server returned an unexpected field`,
    );
  }

  const destDir = resolve(import.meta.dir, '../src/output', outputDir);
  mkdirSync(destDir, { recursive: true });
  const destPath = resolve(destDir, 'avatar.png');
  await Bun.write(destPath, bytes);
  return destPath;
};

// ── Main ─────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const options = parseOptions();

  console.log('🎨 sd-server Avatar Generator\n');
  console.log(`  Prompt:   ${options.prompt}`);
  console.log(`  Negative: ${options.negativePrompt}`);
  console.log(`  Size:     ${options.width}×${options.height}`);
  console.log(`  Steps:    ${options.steps}  CFG: ${options.cfg}`);
  console.log(`  Timeout:  ${options.timeout}s`);
  console.log(`  Seed:     ${options.seed}`);
  console.log(
    `  Model:    ${options.checkpoint || '(engine default — omit --checkpoint to use the loaded model)'}`,
  );
  console.log(
    `  LoRA:     ${options.lora ? `${options.lora} @ ${options.loraStrength}` : '(none)'}`,
  );
  console.log();

  const engine = new SdCppGenerationEngine({
    baseUrl: SD_SERVER,
    queueWaitMs: options.timeout * 1000,
  });

  process.stdout.write('  Submitting...');
  const result = await engine.generate(
    {
      modality: 'image',
      positivePrompt: options.prompt,
      negativePrompt: options.negativePrompt,
      width: options.width,
      height: options.height,
      steps: options.steps,
      cfgScale: options.cfg,
      seed: options.seed,
      ...(options.checkpoint ? { model: options.checkpoint } : {}),
      ...(options.lora
        ? { loras: [{ path: options.lora, multiplier: options.loraStrength }] }
        : {}),
    },
    {
      onProgress: (progress) => {
        process.stdout.write(
          `\r  ${progress.label} ${Math.round(progress.fraction * 100)}%          `,
        );
      },
    },
  );
  process.stdout.write('\n');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = await saveImage(result.bytes, timestamp);
  const size = statSync(path).size;
  console.log(`✓ avatar.png  ${(size / 1024).toFixed(1)}KB`);
  console.log(`\nSaved to: src/output/${timestamp}/avatar.png`);
  console.log(
    `Seed:     ${result.seed ?? options.seed}  (reuse with --seed ${result.seed ?? options.seed})`,
  );
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n✗ ${message}`);
  process.exit(1);
});
