// apps/backend/text/scripts/test_generate.ts
// Test generation script for the Ollama text microservice.
// Sends a prompt to /api/generate and streams the response.
//
// Usage:
//   bun run scripts/test_generate.ts
//   bun run scripts/test_generate.ts "Explain quantum computing in one sentence"
//   bun run scripts/test_generate.ts --model llama3.2:3b "Write a haiku"

const OLLAMA_PORT = 11436;
const OLLAMA_URL = `http://localhost:${OLLAMA_PORT}`;
const DEFAULT_MODEL = 'qwen3.5:4b';
const DEFAULT_PROMPT = 'Say hello and introduce yourself in one sentence.';

// ── Types ──────────────────────────────────────────────────

type GenerateChunk = {
  response?: string;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  error?: string;
};

// ── Helpers ─────────────────────────────────────────────────

/**
 * Format nanoseconds into a human-readable duration.
 */
const formatDuration = (ns: number): string => {
  if (ns < 1000) {
    return `${ns}ns`;
  }
  if (ns < 1_000_000) {
    return `${(ns / 1000).toFixed(1)}µs`;
  }
  if (ns < 1_000_000_000) {
    return `${(ns / 1_000_000).toFixed(1)}ms`;
  }
  return `${(ns / 1_000_000_000).toFixed(2)}s`;
};

// ── Health Check ───────────────────────────────────────────

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

// ── Generate ──────────────────────────────────────────────

/**
 * Send a prompt to /api/generate and stream the token-by-token response.
 *
 * Prints tokens as they arrive, then reports timing metrics on completion.
 */
const generate = async (options: {
  model: string;
  prompt: string;
}): Promise<void> => {
  const { model, prompt } = options;

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: true,
    }),
    signal: AbortSignal.timeout(300_000),
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

  console.log('\n──────────────────────────────────────────\n');

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          continue;
        }

        try {
          const chunk = JSON.parse(trimmed) as GenerateChunk;

          if (chunk.error) {
            throw new Error(chunk.error);
          }

          // Print token as it arrives
          if (chunk.response) {
            process.stdout.write(chunk.response);
          }

          // Report metrics on completion
          if (chunk.done) {
            console.log('\n\n──────────────────────────────────────────\n');
            if (chunk.total_duration !== undefined) {
              console.log(`  Total:      ${formatDuration(chunk.total_duration)}`);
            }
            if (chunk.load_duration !== undefined) {
              console.log(`  Load:       ${formatDuration(chunk.load_duration)}`);
            }
            if (chunk.prompt_eval_count !== undefined) {
              console.log(`  Prompt:     ${chunk.prompt_eval_count} tokens in ${formatDuration(chunk.prompt_eval_duration ?? 0)}`);
            }
            if (chunk.eval_count !== undefined) {
              const evalMs = (chunk.eval_duration ?? 0) / 1_000_000;
              const tps = evalMs > 0 ? ((chunk.eval_count / evalMs) * 1000).toFixed(1) : '?';
              console.log(`  Generated:  ${chunk.eval_count} tokens in ${formatDuration(chunk.eval_duration ?? 0)} (${tps} tok/s)`);
            }
          }
        } catch (parseError) {
          if (!(parseError instanceof SyntaxError)) {
            throw parseError;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  console.log('');
};

// ── Entry Point ─────────────────────────────────────────────

const main = async (): Promise<void> => {
  // Parse args: --model <name> [prompt...]
  const args = Bun.argv.slice(2);
  let model = DEFAULT_MODEL;
  let prompt = '';

  const modelIndex = args.indexOf('--model');
  if (modelIndex !== -1 && args[modelIndex + 1]) {
    model = args[modelIndex + 1];
    args.splice(modelIndex, 2);
  }

  prompt = args.join(' ') || DEFAULT_PROMPT;

  console.log(`\n  Model:  ${model}`);
  console.log(`  Prompt: "${prompt}"`);

  // ── Health check ──────────────────────────────
  if (!(await checkHealth())) {
    console.error(
      `\n✗ Ollama is not running on port ${OLLAMA_PORT}.`,
    );
    console.error('  Start it with: bun herdr:start text');
    process.exit(1);
  }

  await generate({ model, prompt });
};

main();
