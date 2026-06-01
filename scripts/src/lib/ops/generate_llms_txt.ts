// scripts/src/lib/ops/generate_llms_txt.ts
/**
 * Generate .context/llms.txt — AI-first index of all markdown files in docs/.
 * Run after any doc change: bun run scripts -- generate_llms
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '../../../..');
const DOCS_DIR = join(ROOT, 'docs');
const OUTPUT = join(ROOT, '.context', 'llms.txt');

type DocFile = {
  rel: string;
  category: string;
  title: string;
};

function extractTitle(content: string, filename: string): string {
  // Try first markdown heading
  const hMatch = content.match(/^#\s+(.+)/m);
  if (hMatch) {
    return hMatch[1].trim();
  }
  // Fallback to filename
  return filename.replace(/\.md$/, '').replace(/-/g, ' ');
}

function walk(dir: string, base: string): DocFile[] {
  const results: DocFile[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, base));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const rel = relative(base, full);
      const content = readFileSync(full, 'utf8');
      const title = extractTitle(content, entry.name);
      const category = rel.split('/')[0];
      results.push({ rel, category, title });
    }
  }

  return results;
}

function generate(): string {
  const files = walk(DOCS_DIR, DOCS_DIR);
  files.sort((a, b) => a.rel.localeCompare(b.rel));

  const lines: string[] = [];
  const now = new Date().toISOString().split('T')[0];
  const categories = new Set(files.map((f) => f.category));

  lines.push('# Aikami Knowledge Index');
  lines.push('');
  lines.push('> **AI-first entry point.** Read this file first.');
  lines.push(`> Generated: ${now}`);
  lines.push(`> Files: ${files.length} across ${categories.size} categories`);
  lines.push('');
  lines.push('## Quick Start (Read These First)');
  lines.push('');
  lines.push("1. [AI Briefing](CONTEXT.md) — what we're building, tech stack, active contracts");
  lines.push('2. [Contracts Index](contracts/INDEX.md) — active feature contracts');
  lines.push('3. [Architecture](guides/ARCHITECTURE.md) — system design');
  lines.push('4. [Tech Stack](guides/STACK.md) — technology stack');
  lines.push('5. [Coding Standards](guides/CODING_STANDARDS.md) — project conventions');
  lines.push('');
  lines.push('## Main Repo');
  lines.push('');
  lines.push('Monorepo: SvelteKit PWA × Firebase backend × Bun runtime × Moon orchestrator.');
  lines.push('');

  // Category index
  let lastCat = '';
  for (const file of files) {
    if (file.category !== lastCat) {
      lastCat = file.category;
      lines.push(`## ${file.category}/`);
      lines.push('');
    }
    lines.push(`- [${file.title}](${file.rel})`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## How to Use');
  lines.push('');
  lines.push('**For AI tools:**');
  lines.push("1. Read this entire file first — it's the map");
  lines.push('2. Identify 2-5 files relevant to your task');
  lines.push('3. Read those files before writing anything');
  lines.push('');
  lines.push('**For humans:** Browse on GitHub — all markdown renders natively.');
  lines.push('');
  lines.push('**Adding files:** Create markdown in the right category folder.');
  lines.push('Run `bun run scripts -- generate_llms` to update this index.');

  return `${lines.join('\n')}\n`;
}

// Generate and write
const output = generate();
writeFileSync(OUTPUT, output, 'utf8');

console.log(`Generated: ${OUTPUT}`);
console.log(`Files: ${output.split('\n').filter((l) => l.startsWith('- [')).length}`);
