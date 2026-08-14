// .pi/scripts/measure_tool_surface.ts
//
// Reports the always-on prompt cost of the registered tool surface.
//
// 🔴 Every registered tool pins its name, description, promptSnippet,
// promptGuidelines and full JSON Schema into the system prompt on EVERY turn
// of EVERY session — whether or not the session ever calls it. That cost is
// invisible in normal use and only grows, so measure it before adding tools.
//
//   bun run measure-tools
//   CONTRACT_PIPELINE_ROLE=implementer bun run measure-tools   # worker surface
//
// Token counts are a length/4 approximation — good enough to compare runs and
// spot a tool that has quietly become expensive.

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const EXTENSIONS_DIR = join(dirname(import.meta.dir), 'extensions');

/** Approximate tokens for a string. */
const CHARS_PER_TOKEN = 4;

type Tool = {
  name: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
};

/**
 * Stand-in for the pi API that records registerTool and answers every other
 * member with a no-op, so extensions load without a live session.
 */
const recordingPi = () => {
  const tools: Tool[] = [];
  const api = new Proxy(
    { registerTool: (tool: Tool) => tools.push(tool) },
    {
      get: (target, prop) => (prop in target ? Reflect.get(target, prop) : () => undefined),
    },
  );
  return { api, tools };
};

const collected: { file: string; tool: Tool }[] = [];
const skipped: string[] = [];

for (const file of readdirSync(EXTENSIONS_DIR)) {
  if (!file.endsWith('.ts') || file.endsWith('.test.ts')) {
    continue;
  }
  const { api, tools } = recordingPi();
  try {
    const module = await import(join(EXTENSIONS_DIR, file));
    await (module.default as (a: unknown) => unknown)(api);
  } catch (err) {
    skipped.push(`${file}: ${(err as Error).message}`);
    continue;
  }
  for (const tool of tools) {
    collected.push({ file, tool });
  }
}

/** Always-on cost of one tool, in approximate tokens. */
const toolCost = (tool: Tool): number => {
  const payload =
    tool.name +
    tool.description +
    (tool.promptSnippet ?? '') +
    (tool.promptGuidelines ?? []).join('') +
    JSON.stringify(tool.parameters ?? {});
  return Math.round(payload.length / CHARS_PER_TOKEN);
};

const rows = collected
  .map(({ file, tool }) => ({ file, name: tool.name, tokens: toolCost(tool) }))
  .sort((a, b) => b.tokens - a.tokens);

for (const row of rows) {
  console.log(`${String(row.tokens).padStart(6)}  ${row.name.padEnd(20)} ${row.file}`);
}

const total = rows.reduce((sum, row) => sum + row.tokens, 0);
console.log('-'.repeat(52));
console.log(`${String(total).padStart(6)}  TOTAL across ${rows.length} registered tools`);

if (skipped.length > 0) {
  console.log(`\nCould not load ${skipped.length} extension(s):`);
  for (const entry of skipped) {
    console.log(`  - ${entry}`);
  }
  process.exitCode = 1;
}
