/**
 * Worker runner — launches pi with DeepSeek V4 Flash (via DeepInfra) as an
 * Implementation Worker.
 *
 * Usage: bun run worker "implement the blueprint: <paste guru output>"
 *
 * Worker has FULL tool access (write, edit, moon, validate, etc.) and loads
 * the project's default skills via .pi/settings.json. It receives a structured
 * blueprint from the Guru and implements the code changes.
 *
 * Override the provider/model via `.env.local` (gitignored):
 *   WORKER_PROVIDER=deepseek
 *   WORKER_MODEL=deepseek-v4-pro
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const systemPromptPath = resolve(__dirname, 'SYSTEM.md');
const systemPrompt = await Bun.file(systemPromptPath).text();

const userArgs = process.argv.slice(2);

// Per-agent spending caps (DeepSeek worker — moderate budget for coding)
const env = { ...process.env } as Record<string, string>;
if (!env.PI_SOFT_SPEND) {
  env.PI_SOFT_SPEND = '1.00';
}
if (!env.PI_HARD_SPEND) {
  env.PI_HARD_SPEND = '2.00';
}

// Build argv array
const provider = process.env.WORKER_PROVIDER ?? 'deepinfra';
const model = process.env.WORKER_MODEL ?? 'deepseek-ai/DeepSeek-V4-Flash';
const piArgs: string[] = [
  '--provider',
  provider,
  '--model',
  model,
  '--system-prompt',
  systemPrompt,
  ...userArgs,
];

// Worker keeps all default skills and extensions from .pi/settings.json
// No --no-skills, no --exclude-tools — full access

const proc = Bun.spawn(['pi', ...piArgs], {
  stdio: ['inherit', 'inherit', 'inherit'],
  env,
});

const exitCode = await proc.exited;
process.exit(exitCode);
