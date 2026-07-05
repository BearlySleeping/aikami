// apps/backend/text/scripts/check_health.ts
// Health check script for the Ollama text microservice.
// Fetches / and reports readiness.

const OLLAMA_PORT = 11436;
const OLLAMA_URL = `http://localhost:${OLLAMA_PORT}`;

/**
 * Fetch the Ollama / endpoint to verify container readiness.
 */
const checkHealth = async (): Promise<void> => {
  try {
    const response = await fetch(OLLAMA_URL, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(
        `✗ Ollama returned status ${response.status} — container may be booting.`,
      );
      process.exit(1);
    }

    const text = await response.text();

    if (!text.includes('Ollama is running')) {
      console.error('✗ Ollama responded but readiness string not found.');
      process.exit(1);
    }

    console.log('✓ Ollama API is responsive');
    console.log(`  ${text.trim()}`);
  } catch (error) {
    const err = error as Error & { code?: string };

    if (err.code === 'ECONNREFUSED' || err.name === 'TypeError') {
      console.error(
        `✗ Ollama container is not running on port ${OLLAMA_PORT}.`,
      );
      console.error('  Start it with: bun herdr:start text');
    } else {
      console.error(`✗ Health check failed: ${err.message}`);
    }
    process.exit(1);
  }
};

checkHealth();
