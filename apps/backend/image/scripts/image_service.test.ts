// apps/backend/image/scripts/image_service.test.ts
/** biome-ignore-all lint/suspicious/noConsole: CLI test harness — console is the interface */
/** biome-ignore-all lint/style/useNamingConvention: sd-server API uses snake_case fields */
// Integration tests for the sd-server image generation service (C-392).
// Checks if herdr image is active; if not, spawns it, waits for readiness,
// runs health/model/generation checks, and stops only if started by us.
//
// Protocol (sd-server / stable-diffusion.cpp):
//   readiness + models: GET  /sdapi/v1/sd-models  (same probe the C-388
//                        client engine and the compose healthcheck use)
//   generate:           POST /sdcpp/v1/img_gen → GET /sdcpp/v1/jobs/{id}
//
// Usage:
//   bun test scripts/image_service.test.ts

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

// ── Paths ───────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const ROOT = resolve(PROJECT_DIR, '../../..');

// ── Constants ───────────────────────────────────────────────

const SD_SERVER_PORT = 8188;
const BASE_URL = `http://127.0.0.1:${SD_SERVER_PORT}`;
const POLL_INTERVAL_MS = 3000;
const STARTUP_TIMEOUT_MS = 300_000; // sd-server boot can be slow (model loading)

// ── Types ───────────────────────────────────────────────────

type SdModelEntry = {
  title?: string;
  model_name?: string;
};

type SdCppJobState = 'queued' | 'generating' | 'completed' | 'failed' | 'cancelled';

type SdCppJob = {
  id?: string;
  state?: SdCppJobState;
  status?: SdCppJobState;
  progress?: number;
  image?: string;
  images?: readonly unknown[];
  data?: readonly { b64_json?: string; url?: string; image?: string }[];
  message?: string;
  error?: string;
};

// ── State ───────────────────────────────────────────────────

let startedByUs = false;
let modelsAvailable: SdModelEntry[] = [];

// ── Readiness ───────────────────────────────────────────────

const isReady = async (): Promise<{ ok: boolean; detail: string }> => {
  try {
    const response = await fetch(`${BASE_URL}/sdapi/v1/sd-models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return { ok: true, detail: '/sdapi/v1/sd-models OK' };
    }
    return { ok: false, detail: `/sdapi/v1/sd-models returned ${response.status}` };
  } catch (err) {
    const message = (err as Error).message;
    if (
      message.includes('refused') ||
      message.includes('ECONNREFUSED') ||
      message.includes('Unable to connect')
    ) {
      return { ok: false, detail: 'connection refused' };
    }
    return { ok: false, detail: message.slice(0, 80) };
  }
};

const waitForReady = async (timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastDetail = '';
  let wasEverReachable = false;

  while (Date.now() < deadline) {
    const result = await isReady();
    if (result.ok) {
      console.log(`  ✓ Ready (${result.detail})`);
      return;
    }

    if (
      !wasEverReachable &&
      !result.detail.includes('refused') &&
      !result.detail.includes('Unable to connect')
    ) {
      wasEverReachable = true;
    }

    if (result.detail !== lastDetail) {
      if (
        wasEverReachable &&
        (result.detail.includes('refused') || result.detail.includes('Unable to connect'))
      ) {
        throw new Error('sd-server crashed after becoming reachable — check herdr tab logs');
      }
      console.log(`  ... ${result.detail}`);
      lastDetail = result.detail;
    }
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS));
  }
  throw new Error(
    `sd-server did not become ready within ${timeoutMs / 1000}s (last: ${lastDetail})`,
  );
};

// ── Lifecycle ───────────────────────────────────────────────

beforeAll(async () => {
  // Service startup already handled in top-level await if needed
}, STARTUP_TIMEOUT_MS + 60_000);

afterAll(async () => {
  if (!startedByUs) {
    console.log('○ image was already running — leaving it alone');
    return;
  }

  console.log('  Stopping image service...');
  await $`bun run herdr:stop image`.cwd(ROOT).nothrow();
  console.log('✓ image stopped');
});

// ── Top-level await: Discover models for skip logic ────────

const ready = await isReady();
if (!ready.ok) {
  console.log('○ image not running — starting via herdr for prerequisite discovery...');
  console.log(`  Project dir: ${PROJECT_DIR}`);
  console.log(`  Repo root:   ${ROOT}`);

  const startResult = await $`bun run herdr:start image`.cwd(ROOT).nothrow();

  if (startResult.exitCode !== 0) {
    console.error('herdr start failed:', startResult.stderr.toString());
    throw new Error('Failed to start image service via herdr');
  }

  startedByUs = true;
  console.log('  Waiting for sd-server to become ready (may take minutes)...');
  await waitForReady(STARTUP_TIMEOUT_MS);
} else {
  console.log(`✓ image already running (${ready.detail})`);
}

// Now discover models
try {
  const modelsResponse = await fetch(`${BASE_URL}/sdapi/v1/sd-models`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (modelsResponse.ok) {
    const modelsData = (await modelsResponse.json()) as SdModelEntry[];
    modelsAvailable = Array.isArray(modelsData) ? modelsData : [];
  }
} catch (err) {
  console.warn('  ⚠ Failed to discover models:', (err as Error).message);
}

if (modelsAvailable.length === 0) {
  console.warn('  ⚠ No models available — generation test will be skipped');
  console.warn('    Fetch models first: cd apps/backend/local-stack && bun run fetch-models');
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Recursively find an inline image payload (base64 or data URL) in a job.
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

// ── Tests ───────────────────────────────────────────────────

describe('sd-server image generation service', () => {
  test('/sdapi/v1/sd-models returns the loaded model list', async () => {
    const response = await fetch(`${BASE_URL}/sdapi/v1/sd-models`, {
      signal: AbortSignal.timeout(5000),
    });

    expect(response.ok).toBe(true);
    const data = (await response.json()) as SdModelEntry[];
    expect(data).toBeArray();

    console.log(`  ${data.length} model(s) loaded`);
    for (const model of data.slice(0, 5)) {
      console.log(`    • ${model.model_name ?? model.title ?? 'unknown'}`);
    }
  });

  test.skipIf(modelsAvailable.length === 0)(
    '/sdcpp/v1/img_gen generates an image (super lite)',
    async () => {
      // Minimal job: 1 step, 64×64, seed 42.
      const t0 = Date.now();
      const submitResponse = await fetch(`${BASE_URL}/sdcpp/v1/img_gen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'a red pixel',
          width: 64,
          height: 64,
          sample_steps: 1,
          txt_cfg: 1,
          seed: 42,
          batch_count: 1,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!submitResponse.ok) {
        const errorBody = await submitResponse.text();
        throw new Error(
          `Job submission failed (HTTP ${submitResponse.status}):\n${errorBody.slice(0, 300)}`,
        );
      }

      const job = (await submitResponse.json()) as SdCppJob;

      const inline = extractImage(job);
      if (inline) {
        expect(inline.length).toBeGreaterThan(0);
        console.log(`  Output:   inline image (${(inline.length / 1024).toFixed(1)} KB base64)`);
        console.log(`  Wall:     ${Date.now() - t0}ms`);
        return;
      }

      const jobId = job.id ?? (job as unknown as { job?: { id?: string } }).job?.id;
      expect(jobId).toBeString();
      console.log(`  Job:      ${jobId}`);

      // Poll for completion
      let completed: SdCppJob | undefined;
      for (let i = 0; i < 120; i++) {
        const pollResponse = await fetch(`${BASE_URL}/sdcpp/v1/jobs/${jobId}`, {
          signal: AbortSignal.timeout(5000),
        });

        if (!pollResponse.ok) {
          throw new Error(`Job poll failed: ${pollResponse.status}`);
        }

        const polled = (await pollResponse.json()) as SdCppJob;
        const state = polled.state ?? polled.status ?? 'queued';

        if (state === 'completed') {
          completed = polled;
          break;
        }
        if (state === 'failed' || state === 'cancelled') {
          throw new Error(`Job ${state}: ${(polled.message ?? polled.error ?? '').trim()}`);
        }

        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!completed) {
        throw new Error('Generation timed out after 120s');
      }

      const image = extractImage(completed);
      expect(image).toBeDefined();

      console.log(
        `  Output:   inline image (${((image?.length ?? 0) / 1024).toFixed(1)} KB base64)`,
      );
      console.log(`  Wall:     ${Date.now() - t0}ms`);
    },
    180_000,
  );

  test('check_health names the endpoint when the wrong engine answers', async () => {
    // Serve a fake ComfyUI /system_stats on a random port — sd-server's
    // /sdapi/v1/sd-models is absent there, so the probe must fail naming
    // the endpoint + engine.
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url);
        if (url.pathname === '/system_stats') {
          return Response.json({ system: { os: 'mock' } }, { status: 200 });
        }
        return new Response('not found', { status: 404 });
      },
    });
    try {
      const run = await $`bun run scripts/check_health.ts --port ${server.port}`
        .cwd(PROJECT_DIR)
        .nothrow();
      expect(run.exitCode).not.toBe(0);
      const out = run.stdout.toString() + run.stderr.toString();
      expect(out).toContain('/sdapi/v1/sd-models');
      expect(out).toContain('sd-server');
    } finally {
      server.stop();
    }
  }, 30_000);
});
