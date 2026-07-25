/**
 * Scout runner — launches pi with DeepSeek V4 Pro as a Repository Scout.
 *
 * Usage: bun run scout "find auth-related files and format for Claude"
 *
 * Scout explores the codebase and outputs a formatted context block
 * for the Guru (Claude) to analyze.
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
const piArgs: string[] = [
  '--provider',
  'deepseek',
  '--model',
  'deepseek-v4-pro',
  '--system-prompt',
  systemPrompt,
  '--no-skills',
  '--skill',
  '.pi/skills/aikami-conventions',
  '--no-context-files',
  ...userArgs,
  '--exclude-tools',
  'write,edit,bash',
];

// Exec pi, inheriting stdio for full TUI interactivity
const proc = Bun.spawn(['pi', ...piArgs], {
  stdio: ['inherit', 'inherit', 'inherit'],
  env,
});

// Forward exit code
const exitCode = await proc.exited;
process.exit(exitCode);
