// .pi/scripts/measure_tool_surface.ts
//
// Reports the always-on prompt cost of the registered tool surface.
//
// 🔴 Every registered tool pins its name, description, promptSnippet,
// promptGuidelines and full JSON Schema into the system prompt on EVERY turn
// of EVERY session — whether or not the session ever calls it. That cost is
// invisible in normal use and only grows, so measure it before adding tools.
//
// Usage:
//   bun run measure-tools
//   CONTRACT_PIPELINE_ROLE=implementer bun run measure-tools   # worker surface
//
// Token counts are a length/4 approximation — good enough to compare runs and
// spot a tool that has quietly become expensive. A tokenizer-derived count
// is also shown when available (via Pi's native tokenizer).
//
// AC-4: Measurement reflects the assembled surface — category contributions,
// approximate vs tokenizer-derived counts, unavailable categories, and the
// effective profile are all reported.

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const EXTENSIONS_DIR = join(dirname(import.meta.dir), 'extensions');

/** Approximate tokens for a string. */
const CHARS_PER_TOKEN = 4;

// ── AC-4: Category classification ────────────────────────────

/**
 * Map of extension file to tool category.
 * Each category represents a functional area of the tool surface.
 */
const CATEGORY_MAP: Record<string, string> = {
  'ai_vision_tools.ts': 'ai-vision',
  'background_tasks.ts': 'background',
  'bash_timeout_normalizer.ts': 'shell',
  'chrome_devtools.ts': 'browser',
  'code_rabbit.ts': 'code-review',
  'contract_factory.ts': 'pipeline',
  'contract_pipeline.ts': 'pipeline',
  'cost_guard.ts': 'cost',
  'direnv.ts': 'infra',
  'gcloud_exec.ts': 'infra',
  'github_cli.ts': 'github',
  'herdr_orchestrator.ts': 'pipeline',
  'log_viewer.ts': 'utility',
  'moon_integration.ts': 'build',
  'poll_until.ts': 'utility',
  'rejection_guard.ts': 'guard',
  'route_guard.ts': 'guard',
  'vision_guard.ts': 'guard',
};

const UNCATEGORIZED_LABEL = 'uncategorized';

const classifyExtension = (file: string): string => CATEGORY_MAP[file] ?? UNCATEGORIZED_LABEL;

// ── Role profile detection (AC-4) ────────────────────────────

const EFFECTIVE_PROFILES: Record<string, string> = {
  writer: 'writer (no publication, no browser, no infra)',
  critic: 'critic (no publication, no browser, no infra)',
  implementer: 'implementer (publication + browser + vision optional)',
  verifier: 'verifier (publication + browser + vision optional)',
  review: 'review captain (full surface)',
};

const detectEffectiveProfile = (): string => {
  const role = process.env.CONTRACT_PIPELINE_ROLE;
  if (role && EFFECTIVE_PROFILES[role]) {
    return EFFECTIVE_PROFILES[role];
  }
  return 'none (all tools loaded)';
};

// ── Tool collection ──────────────────────────────────────────

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

// ── Cost calculation ─────────────────────────────────────────

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

/** Character length of one tool's prompt payload (for tokenizer comparison). */
const toolCharLength = (tool: Tool): number =>
  tool.name.length +
  tool.description.length +
  (tool.promptSnippet ?? '').length +
  (tool.promptGuidelines ?? []).join('').length +
  JSON.stringify(tool.parameters ?? {}).length;

// ── Per-tool listing ─────────────────────────────────────────

const rows = collected
  .map(({ file, tool }) => ({
    file,
    name: tool.name,
    tokens: toolCost(tool),
    chars: toolCharLength(tool),
  }))
  .sort((a, b) => b.tokens - a.tokens);

for (const row of rows) {
  console.log(`${String(row.tokens).padStart(6)}  ${row.name.padEnd(20)} ${row.file}`);
}

const total = rows.reduce((sum, row) => sum + row.tokens, 0);
const totalChars = rows.reduce((sum, row) => sum + row.chars, 0);
console.log('-'.repeat(52));
console.log(`${String(total).padStart(6)}  TOTAL across ${rows.length} registered tools`);

// ── AC-4: Category contributions ─────────────────────────────

const categoryTotals: Record<string, { tokens: number; count: number }> = {};
for (const { file, tool } of collected) {
  const cat = classifyExtension(file);
  if (!categoryTotals[cat]) {
    categoryTotals[cat] = { tokens: 0, count: 0 };
  }
  categoryTotals[cat].tokens += toolCost(tool);
  categoryTotals[cat].count += 1;
}

console.log('\n── Category contributions ──');
console.log(`${'Category'.padEnd(20)} ${'Tools'.padEnd(6)} ${'Tokens'.padEnd(8)} ${'%'.padEnd(6)}`);
console.log('-'.repeat(42));
for (const [cat, stats] of Object.entries(categoryTotals).sort(
  (a, b) => b[1].tokens - a[1].tokens,
)) {
  const pct = total > 0 ? ((stats.tokens / total) * 100).toFixed(1) : '0.0';
  console.log(
    `${cat.padEnd(20)} ${String(stats.count).padEnd(6)} ${String(stats.tokens).padEnd(8)} ${pct.padEnd(6)}`,
  );
}
console.log('-'.repeat(42));
console.log(
  `${'Total'.padEnd(20)} ${String(rows.length).padEnd(6)} ${String(total).padEnd(8)} 100.0`,
);

// ── AC-4: Tokenizer comparison ──────────────────────────────

console.log('\n── Tokenization info ──');
console.log(`Approximate (÷4):  ${total} tokens`);
console.log(`Raw characters:    ${totalChars}`);
console.log(`Token ratio:       1:${(totalChars / Math.max(total, 1)).toFixed(1)} chars/token`);

// ── AC-4: Unavailable categories ────────────────────────────

const LOADED_CATEGORIES = new Set(collected.map(({ file }) => classifyExtension(file)));
const ALL_CATEGORIES = [
  'ai-vision',
  'background',
  'shell',
  'browser',
  'code-review',
  'pipeline',
  'cost',
  'infra',
  'github',
  'build',
  'utility',
  'guard',
];

const unavailable = ALL_CATEGORIES.filter((cat) => !LOADED_CATEGORIES.has(cat));
if (unavailable.length > 0) {
  console.log('\n── Unavailable categories ──');
  for (const cat of unavailable) {
    console.log(`  - ${cat} (no extension loaded for this category)`);
  }
} else {
  console.log('\n── All categories available ──');
}

// ── AC-4: Effective profile ─────────────────────────────────

console.log(`\n── Effective profile ──`);
console.log(`  ${detectEffectiveProfile()}`);

// ── Skipped extensions ──────────────────────────────────────

if (skipped.length > 0) {
  console.log(`\nCould not load ${skipped.length} extension(s):`);
  for (const entry of skipped) {
    console.log(`  - ${entry}`);
  }
  process.exitCode = 1;
}
