// apps/backend/text/scripts/download_model.ts
// Idempotent model puller for Ollama text microservice.
// Checks if qwen3.5:4b is cached; if not, streams the pull via /api/pull.
//
// Usage:
//   bun run scripts/download_model.ts
//   bun run scripts/download_model.ts qwen3.5:4b
//   bun run scripts/download_model.ts llama3.2:3b

const OLLAMA_PORT = 11436;
const OLLAMA_URL = `http://localhost:${OLLAMA_PORT}`;
const DEFAULT_MODEL = 'qwen3.5:4b';

// ── Types ──────────────────────────────────────────────────

type PullChunk = {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
};

type TagEntry = {
  name: string;
  // model, modified_at, size, digest, details
};

// ── Helpers ─────────────────────────────────────────────────

/**
 * Format bytes into a human-readable string.
 */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)}GB` : `${mb.toFixed(1)}MB`;
};

/**
 * Check if Ollama is running and responsive.
 */
const checkHealth = async (): Promise<boolean> => {
  try {
    const response = await fetch(OLLAMA_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    return response.ok && text.includes('Ollama is running');
  } catch {
    return false;
  }
};

/**
 * Check if a model is already pulled.
 */
const isModelCached = async (model: string): Promise<boolean> => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return false;
    }
    const data = await response.json() as { models?: TagEntry[] };
    const models = data.models ?? [];
    return models.some((m) => m.name === model || m.name === `${model}:latest`);
  } catch {
    return false;
  }
};

// ── Model Pull ──────────────────────────────────────────────

/**
 * Pull a model from the Ollama registry via streaming /api/pull.
 *
 * Ollama returns NDJSON (one JSON object per line) with progress info.
 * We stream the response body, parse each line, and report status.
 */
const pullModel = async (model: string): Promise<void> => {
  const response = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model }),
    signal: AbortSignal.timeout(600_000), // 10 min timeout for large models
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const startTime = Date.now();
  let lastStatus = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines (NDJSON)
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          continue;
        }

        try {
          const chunk = JSON.parse(trimmed) as PullChunk;

          if (chunk.error) {
            throw new Error(chunk.error);
          }

          // Progress reporting
          if (chunk.completed !== undefined && chunk.total !== undefined && chunk.total > 0) {
            const pct = ((chunk.completed / chunk.total) * 100).toFixed(1);
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = elapsed > 0
              ? formatBytes(chunk.completed / elapsed)
              : '...';
            const status = chunk.status || 'downloading';
            process.stdout.write(
              `\r  ${formatBytes(chunk.completed)} / ${formatBytes(chunk.total)} (${pct}%) @ ${speed}/s — ${status}`,
            );
          } else if (chunk.status && chunk.status !== lastStatus) {
            // Status-only update (e.g. "pulling manifest", "verifying digest")
            lastStatus = chunk.status;
            // Use ANSI escape for clear-line + cursor-to-start
            process.stdout.write(`\r\x1b[K  ${chunk.status}`);
          }
        } catch (parseError) {
          // Skip malformed JSON lines (shouldn't happen with Ollama)
          if (!(parseError instanceof SyntaxError)) {
            throw parseError;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Clear progress line
  process.stdout.write('\n');
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`✓ ${model} pulled successfully in ${elapsed.toFixed(1)}s`);
};

// ── Entry Point ─────────────────────────────────────────────

const main = async (): Promise<void> => {
  const model = Bun.argv[2] ?? DEFAULT_MODEL;

  console.log(`\n  Model: ${model}\n`);

  // ── Health check ──────────────────────────────
  if (!(await checkHealth())) {
    console.error(
      `✗ Ollama is not running on port ${OLLAMA_PORT}.`,
    );
    console.error('  Start it with: bun tmux:start text');
    process.exit(1);
  }

  console.log('✓ Ollama is responsive');

  // ── Check if already cached ──────────────────
  if (await isModelCached(model)) {
    console.log(`○ ${model} already cached, skipping pull.\n`);
    process.exit(0);
  }

  // ── Pull the model ───────────────────────────
  console.log(`⬇ Pulling ${model}...`);
  try {
    await pullModel(model);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ Pull failed: ${message}`);
    process.exit(1);
  }

  console.log('');
};

main();
