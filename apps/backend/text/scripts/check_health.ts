// apps/backend/text/scripts/check_health.ts
// Health check for the text dev engine (C-392).
//
// The default text service is llama-server (llama.cpp) from the C-390
// local-stack compose profile. Its readiness endpoint is GET /health —
// NOT Ollama's root banner, which the pre-C-392 service probed.
//
// A failure message names the endpoint tried and the engine expected, so a
// developer running the wrong engine on the right port (e.g. the opt-in
// text-ollama service) gets a comprehensible explanation.
//
// Usage:
//   bun run test:text                 # probe :11434/health
//   bun run scripts/check_health.ts --port 12345

const DEFAULT_PORT = 11434;
const ENGINE = 'llama-server (llama.cpp)';
const ENDPOINT = '/health';

const parsePort = (): number => {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--port');
  if (flag !== -1 && args[flag + 1]) {
    const parsed = Number.parseInt(args[flag + 1] as string, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return DEFAULT_PORT;
};

/**
 * Fetch the llama-server /health endpoint to verify container readiness.
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
        '  Expected the local-stack text engine (llama-server via the "text" compose profile).',
      );
      console.error('  If Ollama is answering on this port, it is the opt-in advanced service:');
      console.error('    bun herdr:stop text-ollama && bun herdr:start text');
      process.exit(1);
    }

    const text = await response.text().catch(() => '');
    console.log(`✓ ${ENGINE} healthy on :${port} (GET ${ENDPOINT})`);
    if (text.trim()) {
      console.log(`  ${text.trim().slice(0, 200)}`);
    }
  } catch (error) {
    const err = error as Error & { code?: string };

    if (err.code === 'ECONNREFUSED' || err.name === 'TypeError') {
      console.error(`✗ ${ENGINE} not reachable on :${port} — GET ${ENDPOINT} failed.`);
      console.error('  Start it with: bun herdr:start text');
      console.error(
        '  The text engine is provided by the local-stack compose profile; fetch its model first with:',
      );
      console.error('    cd apps/backend/local-stack && bun run fetch-models');
    } else {
      console.error(`✗ Health check failed: ${err.message}`);
    }
    process.exit(1);
  }
};

checkHealth();
