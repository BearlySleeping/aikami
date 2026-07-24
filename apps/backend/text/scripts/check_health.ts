// apps/backend/text/scripts/check_health.ts
// Health check script for the Shimmy text microservice.

const SHIMMY_PORT = 11435;
const SHIMMY_URL = `http://localhost:${SHIMMY_PORT}`;

const checkHealth = async (): Promise<void> => {
  try {
    const response = await fetch(`${SHIMMY_URL}/health`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      const text = await response.text();
      console.log('✓ Shimmy API is responsive (/health)');
      console.log(`  ${text.trim()}`);
      return;
    }
  } catch {
    // /health not available; fall back to /v1/models
  }

  try {
    const response = await fetch(`${SHIMMY_URL}/v1/models`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(
        `✗ Shimmy returned status ${response.status} — container may be booting.`,
      );
      process.exit(1);
    }

    const data = await response.json() as { object?: string; data?: unknown[] };
    if (!data.object || data.object !== 'list') {
      console.error('✗ Shimmy responded but /v1/models structure unexpected.');
      process.exit(1);
    }

    const modelCount = Array.isArray(data.data) ? data.data.length : 0;
    console.log('✓ Shimmy API is responsive (/v1/models)');
    console.log(`  ${modelCount} model(s) available`);
  } catch (error) {
    const err = error as Error & { code?: string };

    if (err.code === 'ECONNREFUSED' || err.name === 'TypeError') {
      console.error(
        `✗ Shimmy container is not running on port ${SHIMMY_PORT}.`,
      );
      console.error('  Start it with: bun herdr:start text');
    } else {
      console.error(`✗ Health check failed: ${err.message}`);
    }
    process.exit(1);
  }
};

checkHealth();
