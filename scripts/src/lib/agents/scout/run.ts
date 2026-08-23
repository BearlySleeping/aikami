/**
 * Scout runner — launches pi with DeepSeek V4 Flash (via DeepInfra) as a
 * Repository Scout.
 *
 * Usage: bun run scout "find auth-related files and format for Claude"
 *
 * Scout explores the codebase and outputs a formatted context block
 * for the Guru (Claude) to analyze.
 *
 * Override the provider/model via `.env.local` (gitignored):
 *   SCOUT_PROVIDER=deepseek
 *   SCOUT_MODEL=deepseek-v4-pro
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const systemPromptPath = resolve(__dirname, 'SYSTEM.md');
const systemPrompt = await Bun.file(systemPromptPath).text();

const userArgs = process.argv.slice(2);

// Per-agent spending caps (DeepSeek is cheap — tight limits)
const env = { ...process.env } as Record<string, string>;
if (!env.PI_SOFT_SPEND) {
  env.PI_SOFT_SPEND = '0.15';
}
if (!env.PI_HARD_SPEND) {
  env.PI_HARD_SPEND = '0.25';
}

// Build argv array — Bun.spawn passes directly to process, no shell escaping issues
const provider = process.env.SCOUT_PROVIDER ?? 'deepinfra';
const model = process.env.SCOUT_MODEL ?? 'deepseek-ai/DeepSeek-V4-Flash';
const piArgs: string[] = [
  '--provider',
  provider,
  '--model',
  model,
  '--system-prompt',
  systemPrompt,
  '--no-skills',
  '--skill',
  '.pi/skills/aikami-conventions',
  '--no-context-files',
  ...userArgs,
  '--exclude-tools',
  // `edit_lines` is a distinct tool name registered by pi-deepseek-optimized's
  // hashline-editing module — must be excluded alongside `edit` or scout's
  // read-only contract leaks a write path when a deepseek-pattern model is active.
  'write,edit,edit_lines,bash',
];

// Exec pi, inheriting stdio for full TUI interactivity
const proc = Bun.spawn(['pi', ...piArgs], {
  stdio: ['inherit', 'inherit', 'inherit'],
  env,
});

// Forward exit code
const exitCode = await proc.exited;
process.exit(exitCode);
