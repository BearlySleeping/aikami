// apps/backend/text/scripts/test_generate.ts
// Generation smoke test for the text dev engine (C-392).
//
// Talks the OpenAI-compatible /v1/chat/completions surface of llama-server
// (the C-390 local-stack "text" compose profile). The pre-C-392 service
// spoke Ollama's /api/generate NDJSON stream; llama-server has no such
// concept — it takes a GGUF path at startup and serves /v1 instead.
//
// Usage:
//   bun run test:generate "Hello!"
//   bun run test:generate --model qwen2.5-1.5b-instruct-q4_k_m "Write a haiku"
//
// The model name is the GGUF file name served by llama-server; when omitted
// the smallest model from GET /v1/models is auto-discovered.

const DEFAULT_PORT = 11434;
const DEFAULT_PROMPT = 'Say hello and introduce yourself in one sentence.';

// ── Types ──────────────────────────────────────────────────

type ChatCompletion = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
};

type ModelList = {
  data?: Array<{ id: string }>;
};

// ── Helpers ─────────────────────────────────────────────────

/**
 * Check the llama-server /health endpoint.
 */
const checkHealth = async (port: number): Promise<boolean> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Auto-discover the smallest available model via /v1/models.
 */
const discoverModel = async (port: number): Promise<string | undefined> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return undefined;
    }
    const data = (await response.json()) as ModelList;
    const models = data.data ?? [];
    if (models.length === 0) {
      return undefined;
    }
    // Prefer the smallest id for fast inference.
    return [...models].sort((a, b) => a.id.length - b.id.length)[0]?.id;
  } catch {
    return undefined;
  }
};

/**
 * Send a prompt to /v1/chat/completions and print the completion.
 */
const generate = async (options: {
  port: number;
  model: string;
  prompt: string;
}): Promise<void> => {
  const { port, model, prompt } = options;
  const url = `http://127.0.0.1:${port}/v1/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 256,
      stream: false,
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    if (response.status === 404) {
      throw new Error(
        `Model '${model}' not found (HTTP 404).\n` +
          `Fetch it first: cd apps/backend/local-stack && bun run fetch-models\n` +
          `${errorBody ? `Detail: ${errorBody.slice(0, 200)}` : ''}`,
      );
    }
    throw new Error(
      `Generation request failed (HTTP ${response.status}).\n` +
        `${errorBody ? `Error: ${errorBody.slice(0, 200)}` : 'No error details available.'}`,
    );
  }

  const data = (await response.json()) as ChatCompletion;

  if (data.error) {
    throw new Error(data.error.message ?? 'Generation failed');
  }

  const content = data.choices?.[0]?.message?.content ?? '';
  console.log('\n──────────────────────────────────────────\n');
  console.log(content.trim());
  console.log('\n──────────────────────────────────────────\n');

  if (data.usage) {
    console.log(
      `  Tokens: ${data.usage.prompt_tokens ?? '?'} in / ${data.usage.completion_tokens ?? '?'} out / ${data.usage.total_tokens ?? '?'} total`,
    );
  }
};

// ── Entry Point ─────────────────────────────────────────────

const main = async (): Promise<void> => {
  const args = Bun.argv.slice(2);
  let model = '';
  let prompt = '';
  let port = DEFAULT_PORT;

  const modelIndex = args.indexOf('--model');
  if (modelIndex !== -1 && args[modelIndex + 1]) {
    model = args[modelIndex + 1] as string;
    args.splice(modelIndex, 2);
  }
  const portIndex = args.indexOf('--port');
  if (portIndex !== -1 && args[portIndex + 1]) {
    port = Number.parseInt(args[portIndex + 1] as string, 10) || DEFAULT_PORT;
    args.splice(portIndex, 2);
  }

  prompt = args.join(' ') || DEFAULT_PROMPT;

  // ── Health check ──────────────────────────────
  if (!(await checkHealth(port))) {
    console.error(`\n✗ llama-server is not running on port ${port}.`);
    console.error('  Start it with: bun herdr:start text');
    process.exit(1);
  }

  // ── Auto-discover model if not specified ──────
  if (!model) {
    model = (await discoverModel(port)) ?? '';
    if (!model) {
      console.error('\n✗ No models available. Fetch one first:');
      console.error('  cd apps/backend/local-stack && bun run fetch-models');
      process.exit(1);
    }
    console.log(`\n  Auto-detected model: ${model}`);
  }

  console.log(`  Model:  ${model}`);
  console.log(`  Prompt: "${prompt}"`);

  try {
    await generate({ port, model, prompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ ${message}`);
    process.exit(1);
  }
};

main();
