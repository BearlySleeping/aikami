// apps/backend/text/scripts/test_generate.ts
// Test generation and benchmark for Shimmy text microservice.

const SHIMMY_PORT = process.env.SHIMMY_PORT || 11435;
const SHIMMY_URL = `http://localhost:${SHIMMY_PORT}`;
const DEFAULT_PROMPT = 'Say hello and introduce yourself in one sentence.';

type ChatCompletionChunk = {
  id: string;
  choices: Array<{
    delta: { content?: string };
    finish_reason: string | null;
  }>;
};

const checkHealth = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${SHIMMY_URL}/v1/models`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
};

const processSSEBuffer = (buffer: string): { processed: number; remaining: string } => {
  const lines = buffer.split('\n');
  const remaining = lines.pop() ?? '';
  let tokenCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;

    try {
      const chunk = JSON.parse(trimmed.slice(6)) as ChatCompletionChunk;
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) {
        process.stdout.write(content);
        tokenCount++;
      }
    } catch {
      // Ignore incomplete frames
    }
  }

  return { processed: tokenCount, remaining };
};

const chatCompletion = async (model: string, prompt: string): Promise<void> => {
  const response = await fetch(`${SHIMMY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 256,
      stream: true,
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalTokens = 0;
  const startTime = Date.now();

  console.log('\n──────────────────────────────────────────\n');

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          const { processed } = processSSEBuffer(buffer + '\n');
          totalTokens += processed;
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const { processed, remaining } = processSSEBuffer(buffer);
      totalTokens += processed;
      buffer = remaining;
    }
  } finally {
    reader.releaseLock();
  }

  const elapsed = Date.now() - startTime;
  const tps = elapsed > 0 ? ((totalTokens / elapsed) * 1000).toFixed(1) : '0';

  console.log('\n\n──────────────────────────────────────────\n');
  console.log(`  Tokens: ${totalTokens}`);
  console.log(`  Time:   ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`  Speed:  ${tps} tok/s`);
};

const main = async () => {
  if (!(await checkHealth())) {
    console.error(`✗ Shimmy is not reachable on ${SHIMMY_URL}`);
    process.exit(1);
  }

  const modelsRes = await fetch(`${SHIMMY_URL}/v1/models`);
  const modelsData = (await modelsRes.json()) as { data?: Array<{ id: string }> };
  const model = modelsData.data?.[0]?.id || 'default';

  console.log(`  Model:  ${model}`);
  console.log(`  Prompt: "${DEFAULT_PROMPT}"`);

  await chatCompletion(model, DEFAULT_PROMPT);
};

main();
