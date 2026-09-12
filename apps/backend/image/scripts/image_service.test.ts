// apps/backend/image/scripts/image_service.test.ts
/** biome-ignore-all lint/suspicious/noConsole: CLI test harness — console is the interface */
/** biome-ignore-all lint/style/useNamingConvention: sd-server API uses snake_case fields */
// Integration tests for the sd-server image generation service (C-392).
// Checks if herdr image is active; if not, spawns it, waits for readiness,
// runs health/model/generation checks, and stops only if started by us.
//
// C-510: the generation transport lives in @aikami/local-ai's
// SdCppGenerationEngine. This harness no longer declares the job shape, the
// inline-image extractor or the sd-server generation endpoints — it drives the shared
// client, which is what the CLI and the client engine use in production.
//
// Protocol (sd-server / stable-diffusion.cpp):
//   readiness + models: GET  /sdapi/v1/sd-models  (same probe the C-388
//                        client engine and the compose healthcheck use)
//   generate:           via SdCppGenerationEngine (submit → poll → inline)
//
// Usage:
//   bun test scripts/image_service.test.ts

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SdCppGenerationEngine } from '@aikami/local-ai';
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
    'SdCppGenerationEngine generates an image (super lite)',
    async () => {
      // Minimal job: 1 step, 64×64, seed 42 — driven through the shared
      // transport the CLI and the client engine both use.
      const t0 = Date.now();
      const engine = new SdCppGenerationEngine({ baseUrl: BASE_URL, queueWaitMs: 180_000 });

      const result = await engine.generate({
        modality: 'image',
        positivePrompt: 'a red pixel',
        width: 64,
        height: 64,
        steps: 1,
        cfgScale: 1,
        seed: 42,
      });

      expect(result.engine).toBe('sdcpp');
      expect(result.bytes.length).toBeGreaterThan(0);
      expect(result.mimeType).toMatch(/^image\//);

      console.log(`  Output:   ${(result.bytes.length / 1024).toFixed(1)} KB ${result.mimeType}`);
      console.log(`  Size:     ${result.width}×${result.height}`);
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
