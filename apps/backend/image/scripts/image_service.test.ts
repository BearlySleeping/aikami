// apps/backend/image/scripts/image_service.test.ts
// Integration tests for the ComfyUI image generation service.
// Checks if herdr image is active; if not, spawns it, waits for readiness,
// runs health/model/generation checks, and stops only if started by us.
//
// Usage:
//   bun test scripts/image_service.test.ts

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { $ } from 'bun';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Paths ───────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const ROOT = resolve(PROJECT_DIR, '../../..');

// ── Constants ───────────────────────────────────────────────

const COMFYUI_PORT = 8188;
const BASE_URL = `http://127.0.0.1:${COMFYUI_PORT}`;
const POLL_INTERVAL_MS = 3000;
const STARTUP_TIMEOUT_MS = 300_000; // ComfyUI boot is slow (model loading)

// ── Types ───────────────────────────────────────────────────

type SystemStats = {
  system?: Record<string, unknown>;
  devices?: Array<{ name: string; type: string }>;
};

type ObjectInfo = Record<string, unknown>;

type PromptResponse = {
  prompt_id: string;
  error?: string;
  node_errors?: Record<string, unknown>;
};

type HistoryEntry = {
  outputs: Record<string, { images: Array<{ filename: string; subfolder: string; type: string }> }>;
  status: {
    status_str: string;
    completed: boolean;
  };
};

// ── State ───────────────────────────────────────────────────

let startedByUs = false;
let checkpointsAvailable: string[] = [];

// ── Readiness ───────────────────────────────────────────────

const isReady = async (): Promise<{ ok: boolean; detail: string }> => {
  try {
    const response = await fetch(`${BASE_URL}/system_stats`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = (await response.json()) as SystemStats;
      const deviceInfo = data.devices?.[0]?.name ?? 'unknown';
      return { ok: true, detail: `/system_stats OK — device: ${deviceInfo}` };
    }
    return { ok: false, detail: `/system_stats returned ${response.status}` };
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

    if (!wasEverReachable && !result.detail.includes('refused') && !result.detail.includes('Unable to connect')) {
      wasEverReachable = true;
    }

    if (result.detail !== lastDetail) {
      if (wasEverReachable && (result.detail.includes('refused') || result.detail.includes('Unable to connect'))) {
        throw new Error('ComfyUI crashed after becoming reachable — check herdr tab logs');
      }
      console.log(`  ... ${result.detail}`);
      lastDetail = result.detail;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`ComfyUI did not become ready within ${timeoutMs / 1000}s (last: ${lastDetail})`);
};

// ── Lifecycle ───────────────────────────────────────────────

beforeAll(async () => {
  // Service startup already handled in top-level await if needed
  // This hook is now just a placeholder for test framework lifecycle
}, STARTUP_TIMEOUT_MS + 60_000);

afterAll(async () => {
  if (!startedByUs) {
    console.log('○ ComfyUI was already running — leaving it alone');
    return;
  }

  console.log('  Stopping image service...');
  await $`bun run herdr:stop image`.cwd(ROOT).nothrow();
  console.log('✓ ComfyUI stopped');
});

// ── Top-level await: Discover checkpoints for skip logic ────

// Ensure service is ready and discover available checkpoints before test registration
const ready = await isReady();
if (!ready.ok) {
  console.log('○ ComfyUI not running — starting via herdr for prerequisite discovery...');
  console.log(`  Project dir: ${PROJECT_DIR}`);
  console.log(`  Repo root:   ${ROOT}`);

  const startResult = await $`bun run herdr:start image`.cwd(ROOT).nothrow();

  if (startResult.exitCode !== 0) {
    console.error('herdr start failed:', startResult.stderr.toString());
    throw new Error('Failed to start image service via herdr');
  }

  startedByUs = true;
  console.log('  Waiting for ComfyUI to become ready (may take minutes)...');
  await waitForReady(STARTUP_TIMEOUT_MS);
} else {
  console.log(`✓ ComfyUI already running (${ready.detail})`);
}

// Now discover checkpoints
try {
  const infoResponse = await fetch(`${BASE_URL}/object_info`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (infoResponse.ok) {
    const infoData = (await infoResponse.json()) as ObjectInfo;
    const loader = infoData.CheckpointLoaderSimple as {
      input?: { required?: { ckpt_name?: [string[]] } };
    };
    checkpointsAvailable = loader?.input?.required?.ckpt_name?.[0] ?? [];
  }
} catch (err) {
  console.warn('  ⚠ Failed to discover checkpoints:', (err as Error).message);
}

if (checkpointsAvailable.length === 0) {
  console.warn('  ⚠ No checkpoints available — generation test will be skipped');
  console.warn('    Download models first: bun run download:model');
}

// ── Tests ───────────────────────────────────────────────────

describe('ComfyUI image generation service', () => {
  test('/system_stats returns device and system info', async () => {
    const response = await fetch(`${BASE_URL}/system_stats`, {
      signal: AbortSignal.timeout(5000),
    });

    expect(response.ok).toBe(true);
    const data = (await response.json()) as SystemStats;
    expect(data.system).toBeDefined();

    console.log(`  System:  ${JSON.stringify(data.system)}`);
    if (data.devices && data.devices.length > 0) {
      for (const device of data.devices) {
        console.log(`  Device:  ${device.name} (${device.type})`);
      }
    }
  });

  test('/object_info lists available nodes and checkpoints', async () => {
    const response = await fetch(`${BASE_URL}/object_info`, {
      signal: AbortSignal.timeout(5000),
    });

    expect(response.ok).toBe(true);
    const data = (await response.json()) as ObjectInfo;

    // Check for key node types
    expect(data.CheckpointLoaderSimple).toBeDefined();
    expect(data.KSampler).toBeDefined();
    expect(data.VAEDecode).toBeDefined();

    // Extract checkpoint names
    const loader = data.CheckpointLoaderSimple as {
      input?: { required?: { ckpt_name?: [string[]] } };
    };
    const checkpoints: string[] = loader?.input?.required?.ckpt_name?.[0] ?? [];
    console.log(`  ${Object.keys(data).length} node types registered`);
    console.log(`  ${checkpoints.length} checkpoint(s) available`);
    for (const ckpt of checkpoints.slice(0, 5)) {
      console.log(`    • ${ckpt}`);
    }
    if (checkpoints.length > 5) {
      console.log(`    … and ${checkpoints.length - 5} more`);
    }
  });

  test.skipIf(checkpointsAvailable.length === 0)('/api/prompt generates an image (super lite)', async () => {
    const checkpoint = checkpointsAvailable[0];
    console.log(`  Checkpoint: ${checkpoint}`);

    // Minimal workflow: 1 step, 64×64, seed 42
    const workflow = {
      '1': {
        inputs: { ckpt_name: checkpoint },
        class_type: 'CheckpointLoaderSimple',
      },
      '2': {
        inputs: { text: 'test', clip: ['1', 1] },
        class_type: 'CLIPTextEncode',
      },
      '3': {
        inputs: { text: '', clip: ['1', 1] },
        class_type: 'CLIPTextEncode',
      },
      '4': {
        inputs: { width: 64, height: 64, batch_size: 1 },
        class_type: 'EmptyLatentImage',
      },
      '5': {
        inputs: {
          seed: 42,
          steps: 1,
          cfg: 1,
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
        inputs: { images: ['6', 0], filename_prefix: 'aikami_test' },
        class_type: 'SaveImage',
      },
    };

    // Submit
    const t0 = Date.now();
    const promptResponse = await fetch(`${BASE_URL}/api/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!promptResponse.ok) {
      const errorBody = await promptResponse.text();
      throw new Error(`Prompt submission failed (HTTP ${promptResponse.status}):\n${errorBody.slice(0, 300)}`);
    }

    const promptData = (await promptResponse.json()) as PromptResponse;
    expect(promptData.prompt_id).toBeString();

    if (promptData.error) {
      throw new Error(`Prompt error: ${JSON.stringify(promptData.error)}`);
    }

    const promptId = promptData.prompt_id;
    console.log(`  Prompt:   ${promptId}`);

    // Poll for completion
    const historyUrl = `${BASE_URL}/api/history/${promptId}`;
    let entry: HistoryEntry | undefined;

    for (let i = 0; i < 120; i++) {
      const histResponse = await fetch(historyUrl, {
        signal: AbortSignal.timeout(5000),
      });

      if (!histResponse.ok) {
        throw new Error(`History fetch failed: ${histResponse.status}`);
      }

      const histData = (await histResponse.json()) as Record<string, HistoryEntry>;
      entry = histData[promptId];

      if (entry) {
        if (entry.status.completed) {
          break;
        }
        if (entry.status.status_str === 'error') {
          throw new Error('Generation failed — check ComfyUI logs');
        }
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!entry) {
      throw new Error('Generation timed out after 120s');
    }

    const wallMs = Date.now() - t0;
    expect(entry.status.completed).toBe(true);

    // Verify output
    const outputNodeIds = Object.keys(entry.outputs);
    expect(outputNodeIds.length).toBeGreaterThan(0);

    const images = entry.outputs[outputNodeIds[0]].images;
    expect(images.length).toBeGreaterThan(0);
    expect(images[0].filename).toBeString();
    expect(images[0].filename.length).toBeGreaterThan(0);

    console.log(`  Output:   ${images[0].filename}`);
    console.log(`  Wall:     ${wallMs}ms`);
  }, 180_000);
});
