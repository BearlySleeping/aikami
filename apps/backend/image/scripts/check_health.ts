// apps/backend/image/scripts/check_health.ts
// Health check for the image dev engine (C-392).
//
// The default image service is sd-server (stable-diffusion.cpp) from the
// C-390 local-stack compose profile. Its readiness probe is
// GET /sdapi/v1/sd-models — the same probe the C-388 client engine and the
// compose healthcheck use — NOT ComfyUI's /system_stats.
//
// A failure message names the endpoint tried and the engine expected, so a
// developer running the wrong engine on the right port (e.g. the opt-in
// image-comfyui service) gets a comprehensible explanation.
//
// Usage:
//   bun run test:image                # probe :8188/sdapi/v1/sd-models
//   bun run scripts/check_health.ts --port 12345

const DEFAULT_PORT = 8188;
const ENGINE = 'sd-server (stable-diffusion.cpp)';
const ENDPOINT = '/sdapi/v1/sd-models';

const parsePort = (): number => {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--port');
  if (flag !== -1 && args[flag + 1]) {
    const parsed = Number.parseInt(args[flag + 1] as string, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
      return parsed;
    }
  }
  return DEFAULT_PORT;
};

/**
 * Fetch the sd-server sd-models endpoint to verify container readiness.
 */
const checkHealth = async (): Promise<void> => {
  const port = parsePort();
  const url = `http://127.0.0.1:${port}${ENDPOINT}`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(
        `✗ ${ENGINE} not healthy — GET ${ENDPOINT} on :${port} returned HTTP ${response.status}.`,
      );
      console.error(
        '  Expected the local-stack image engine (sd-server via the "image" compose profile).',
      );
      console.error('  If ComfyUI is answering on this port, it is the opt-in advanced service:');
      console.error('    bun herdr:stop image-comfyui && bun herdr:start image');
      process.exit(1);
    }

    const data = (await response.json()) as Array<{ title?: string; model_name?: string }>;
    const modelCount = Array.isArray(data) ? data.length : 0;
    console.log(`✓ ${ENGINE} healthy on :${port} (GET ${ENDPOINT})`);
    console.log(`  ${modelCount} model(s) loaded`);
  } catch (error) {
    const err = error as Error & { code?: string };

    if (err.code === 'ECONNREFUSED' || err.name === 'TypeError') {
      console.error(`✗ ${ENGINE} not reachable on :${port} — GET ${ENDPOINT} failed.`);
      console.error('  Start it with: bun herdr:start image');
      console.error(
        '  The image engine is provided by the local-stack compose profile; fetch its model first with:',
      );
      console.error('    cd apps/backend/local-stack && bun run fetch-models');
    } else {
      console.error(`✗ Health check failed: ${err.message}`);
    }
    process.exit(1);
  }
};

checkHealth();
