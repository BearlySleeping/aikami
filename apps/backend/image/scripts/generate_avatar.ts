// apps/backend/image/scripts/generate_avatar.ts
/** biome-ignore-all lint/suspicious/noConsole: CLI script — console is the interface */
// Avatar generation CLI for the image dev engine (C-392).
//
// The default image service is sd-server (stable-diffusion.cpp) from the
// C-390 local-stack compose profile. The pre-C-392 CLI submitted a ComfyUI
// graph and polled /api/history; sd-server exposes a job-based native API:
//
//   POST /sdcpp/v1/img_gen            → create a job
//   GET  /sdcpp/v1/jobs/{id}          → poll state (queued/generating/completed)
//   GET  /sdapi/v1/sd-models          → model listing
//
// The job payload carries the image inline (base64) — no second fetch hop.
//
// CLI surface is preserved (AC-5): --steps, --cfg, --seed, --width,
// --height, --checkpoint all keep working; only the transport changed.
// --checkpoint maps to the sd-server `model` field (the GGUF file name
// under /models/image/, e.g. flux1-schnell-q4_k.gguf).
//
// Usage:
//   bun run generate:avatar "an elven ranger, pixel art"
//   bun run generate:avatar "a knight" --steps 20 --cfg 7 --seed 42 \
//     --width 512 --height 512 --checkpoint flux1-schnell-q4_k.gguf

// biome-ignore-all lint/style/useNamingConvention: sd-server API uses snake_case fields
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const SD_SERVER = 'http://127.0.0.1:8188';

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
 * Parse CLI arguments into generation options. The pre-C-392 flag surface
 * (--steps/--cfg/--seed/--width/--height/--checkpoint) is preserved; the
 * default checkpoint now names the shared-store GGUF used by sd-server.
 */
const parseOptions = (): GenerationOptions => {
  const args = process.argv.slice(2);
  const prompt = args.find((a) => !a.startsWith('--')) ?? '';

  const getArg = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? (args[idx + 1] as string) : fallback;
  };

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
    checkpoint: getArg('--checkpoint', 'flux1-schnell-q4_k.gguf'),
  };
};

// ── API Types ────────────────────────────────────────────────────────────

type SdCppJobState = 'queued' | 'generating' | 'completed' | 'failed' | 'cancelled';

type SdCppJob = {
  id?: string;
  state?: SdCppJobState;
  status?: SdCppJobState;
  progress?: number;
  width?: number;
  height?: number;
  image?: string;
  images?: readonly unknown[];
  data?: readonly { b64_json?: string; url?: string; image?: string }[];
  message?: string;
  error?: string;
};

// ── API Helpers ──────────────────────────────────────────────────────────

/**
 * Submit a txt2img job to sd-server and return the raw response.
 */
const submitJob = async (options: GenerationOptions): Promise<SdCppJob> => {
  const body = {
    prompt: options.prompt,
    negative_prompt: options.negativePrompt,
    width: options.width,
    height: options.height,
    sample_steps: options.steps,
    txt_cfg: options.cfg,
    seed: options.seed,
    batch_count: 1,
    model: options.checkpoint,
  };

  const response = await fetch(`${SD_SERVER}/sdcpp/v1/img_gen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to submit job: ${response.status} — ${text.slice(0, 300)}`);
  }

  return (await response.json()) as SdCppJob;
};

/**
 * Extract a job id, tolerating builds that nest it or return inline images.
 */
const extractJobId = (job: SdCppJob): string | undefined => {
  if (job.id && job.id.length > 0) {
    return job.id;
  }
  const nested = (job as unknown as Record<string, unknown>).job; // guard-ignore lint/type-safety/casting: AI provider response parsed as unknown; schema validated at API boundary
  if (nested && typeof nested === 'object') {
    const nestedId = (nested as Record<string, unknown>).id;
    if (typeof nestedId === 'string') {
      return nestedId;
    }
  }
  return undefined;
};

/**
 * Poll a job until it reaches a terminal state, bounded by a wall-clock
 * deadline (the poll request itself can take up to 10s per iteration, so a
 * fixed iteration count would not bound wall time).
 */
const waitForJob = async (jobId: string): Promise<SdCppJob> => {
  const url = `${SD_SERVER}/sdcpp/v1/jobs/${jobId}`;
  const deadline = Date.now() + 180_000;
  let poll = 0;

  while (Date.now() < deadline) {
    poll++;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Job poll failed: ${response.status}`);
    }

    const job = (await response.json()) as SdCppJob;
    const state = job.state ?? job.status ?? 'queued';

    if (state === 'completed') {
      return job;
    }
    if (state === 'failed' || state === 'cancelled') {
      throw new Error(`Generation ${state}: ${(job.message ?? job.error ?? '').trim()}`);
    }

    const progress = typeof job.progress === 'number' ? ` ${job.progress}%` : ` (poll ${poll})`;
    process.stdout.write(`\r  Status: ${state}${progress}`);

    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(1000, deadline - Date.now()))));
  }

  throw new Error('Generation timed out after 180s');
};

/**
 * Recursively find an inline image payload (data URL or base64) in a job.
 */
const extractImage = (payload: unknown): string | undefined => {
  if (typeof payload === 'string') {
    return payload.startsWith('data:') || payload.length >= 64 ? payload : undefined;
  }
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const obj = payload as Record<string, unknown>;

  if (Array.isArray(obj.data)) {
    for (const item of obj.data) {
      const found = extractImage(item);
      if (found) {
        return found;
      }
    }
  }
  if (Array.isArray(obj.images)) {
    for (const item of obj.images) {
      const found = extractImage(item);
      if (found) {
        return found;
      }
    }
  }

  for (const key of ['image', 'b64_json', 'output', 'result']) {
    const found = extractImage(obj[key]);
    if (found) {
      return found;
    }
  }

  return undefined;
};

/**
 * Decode a base64 or data-URL image payload and write it to disk.
 */
const saveImage = async (imageData: string, outputDir: string): Promise<string> => {
  const base64 = imageData.startsWith('data:') ? (imageData.split(',')[1] ?? '') : imageData;
  const bytes = Buffer.from(base64, 'base64');

  // Fail loudly on a bad payload instead of writing garbage: sd-server may
  // echo a long prompt/id under one of the scanned fields, which decodes to
  // short meaningless bytes that would otherwise be reported as success.
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  if (bytes.length < 8 || !bytes.subarray(0, 4).equals(PNG_MAGIC)) {
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
  console.log(`  Seed:     ${options.seed}`);
  console.log(`  Model:    ${options.checkpoint}`);
  console.log();

  // ── Submit job ───────────────────────────────────
  process.stdout.write('  Submitting...');
  const job = await submitJob(options);

  const inline = extractImage(job);
  if (inline) {
    const path = await saveImage(inline, 'inline');
    const size = statSync(path).size;
    console.log(` inline image received`);
    console.log(`✓ ${path}  ${(size / 1024).toFixed(1)}KB`);
    console.log(`  Seed: ${options.seed}  (reuse with --seed ${options.seed})`);
    return;
  }

  const jobId = extractJobId(job);
  if (!jobId) {
    throw new Error('sd-server did not return a job id or image');
  }
  process.stdout.write(` job_id=${jobId}\n`);

  // ── Wait for completion ──────────────────────────
  console.log('  Generating...');
  const completed = await waitForJob(jobId);
  process.stdout.write('\n');

  // ── Extract + save output ────────────────────────
  const imageData = extractImage(completed);
  if (!imageData) {
    console.error('✗ Job completed without an image payload');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = await saveImage(imageData, timestamp);
  const size = statSync(path).size;
  console.log(`✓ avatar.png  ${(size / 1024).toFixed(1)}KB`);

  console.log(`\nSaved to: src/output/${timestamp}/avatar.png`);
  console.log(`Seed:     ${options.seed}  (reuse with --seed ${options.seed})`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n✗ ${message}`);
  process.exit(1);
});
