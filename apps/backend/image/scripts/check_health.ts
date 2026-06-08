// apps/backend/image/scripts/check_health.ts
// Health check script for the ComfyUI image microservice.
// Fetches /system_stats and reports readiness.

const COMFYUI_PORT = 8188;
const COMFYUI_URL = `http://localhost:${COMFYUI_PORT}`;

/**
 * Fetch the ComfyUI /system_stats endpoint to verify container readiness.
 */
const checkHealth = async (): Promise<void> => {
  try {
    const response = await fetch(`${COMFYUI_URL}/system_stats`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(
        `✗ ComfyUI returned status ${response.status} — container may be booting.`,
      );
      process.exit(1);
    }

    const data = await response.json();
    console.log('✓ ComfyUI API is responsive');
    console.log(`  System: ${JSON.stringify(data.system ?? 'unknown')}`);
  } catch (error) {
    const err = error as Error & { code?: string };

    if (err.code === 'ECONNREFUSED' || err.name === 'TypeError') {
      console.error(
        `✗ ComfyUI container is not running on port ${COMFYUI_PORT}.`,
      );
      console.error('  Start it with: bun tmux:start image');
    } else {
      console.error(`✗ Health check failed: ${err.message}`);
    }
    process.exit(1);
  }
};

checkHealth();
