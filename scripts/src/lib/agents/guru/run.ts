/**
 * Guru runner — launches pi with Claude Sonnet 4 as a Lead Systems Architect.
 *
 * Usage: bun run guru
 *
 * Paste the Scout's <context> output and Claude will analyze, find root causes,
 * and produce a structured implementation blueprint for the Worker (DeepSeek).
 *
 * Claude gets: read + bash tools (no write/edit), minimal skills, medium thinking.
 * This saves ~60-70% tokens vs a full coding session.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const systemPromptPath = resolve(__dirname, 'SYSTEM.md');
const systemPrompt = await Bun.file(systemPromptPath).text();

const userArgs = process.argv.slice(2);

// Per-agent spending caps (Claude is expensive — generous but protected)
const env = { ...process.env } as Record<string, string>;
if (!env.PI_SOFT_SPEND) {
  env.PI_SOFT_SPEND = '10.00';
}
if (!env.PI_HARD_SPEND) {
  env.PI_HARD_SPEND = '15.00';
}

// Build argv array
const piArgs: string[] = [
  '--model',
  'claude-sonnet-5',
  '--system-prompt',
  systemPrompt,
  // '--thinking',
  // 'high',
  '--no-skills',
  '--skill',
  '.pi/skills/aikami-conventions',
  '--skill',
  '.pi/skills/aikami-standards',
  '--no-context-files',
  ...userArgs,
  '--exclude-tools',
  'write,edit,bash',
];

const proc = Bun.spawn(['pi', ...piArgs], {
  stdio: ['inherit', 'inherit', 'inherit'],
  env,
});

const exitCode = await proc.exited;
process.exit(exitCode);
