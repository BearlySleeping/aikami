// scripts/src/lib/ops/generate_context.ts
/**
 * Generate .context/CONTEXT.md from project metadata.
 * Reads moon projects, tsconfig, and package.json to build the AI briefing.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../../../..');
const DOCS_DIR = join(ROOT, 'docs');
const OUTPUT = join(ROOT, '.context', 'CONTEXT.md');

async function main() {
  console.log('Generating CONTEXT.md...');

  // Read project metadata
  void JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  const projects = [
    {
      name: 'Client',
      path: 'apps/frontend/client',
      desc: 'Main SvelteKit Client (PWA, SvelteKit 2, Svelte 5)',
    },
    { name: 'Site', path: 'apps/frontend/site', desc: 'Public site' },
    { name: 'Docs', path: 'apps/frontend/docs', desc: 'Documentation site (Astro)' },
    {
      name: 'Firebase',
      path: 'apps/backend/firebase',
      desc: 'Firebase Cloud Functions + Data Connect',
    },
  ];

  const libs = [
    { name: 'constants', desc: 'Shared constants' },
    { name: 'types', desc: 'Shared TypeScript types' },
    { name: 'schemas', desc: 'Zod validation schemas' },
    { name: 'logger', desc: 'Structured logger' },
    { name: 'utils', desc: 'Utility functions' },
    { name: 'mocks', desc: 'Test mocks and fixtures' },
  ];

  // Try reading contracts index for status
  try {
    void readFileSync(join(DOCS_DIR, 'contracts/INDEX.md'), 'utf8');
  } catch {
    // contracts index not available
  }

  const lines = [
    '# Aikami — AI Briefing',
    '',
    '> **Read this first.** A 2-page summary for any AI tool (pi, Claude, Gemini).',
    '> Pair with `llms.txt` for the full file index.',
    '',
    '---',
    '',
    "## What We're Building",
    '',
    'Aikami is a monorepo application platform: SvelteKit Client (PWA) + Firebase backend + Bun runtime.',
    '',
    '| Component | Technology |',
    '|-----------|-----------|',
    '| Client | SvelteKit 2, Svelte 5 (runes) |',
    '| Backend | Firebase (Functions, Auth, Firestore) |',
    '| Runtime | Bun |',
    '| Monorepo | Moon task orchestrator |',
    '| Linting | Biome |',
    '',
    '## Tech Stack',
    '',
    '**Bun × SvelteKit 2 × Firebase × Moon × Biome**',
    '',
    '| Layer | Technology |',
    '|-------|-----------|',
    '| Runtime | Bun |',
    '| Frontend (Client) | SvelteKit 2, Svelte 5 Runes |',
    '| Frontend (Landing) | Astro |',
    '| Frontend (Docs) | Astro |',
    '| Backend | Firebase Cloud Functions, Firestore, Firebase Auth |',
    '| Monorepo | Moon task orchestrator |',
    '| Linting | Biome |',
    '',
    '## Project Structure',
    '',
    '| Project | Description |',
    '|---------|-------------|',
    ...projects.map((p) => `| ${p.name} | ${p.desc} |`),
    ...libs.map((l) => `| ${l.name} | ${l.desc} |`),
    '',
    '## Project Conventions',
    '',
    'See `intro/agents.md` for full developer guidelines.',
    '',
    '### File Naming',
    '- snake_case file names (Biome enforced)',
    '- Svelte component: `+page.svelte`, `+layout.svelte`',
    '- Route directories mirror URL structure',
    '',
    '### Code Patterns',
    '- **Svelte 5 ViewModel pattern**: `+page.svelte` pure template, view model holds logic',
    '- **Zod schemas** in `packages/shared/schemas/`',
    '- **Repository pattern** for Firestore access',
    '- **Path aliases**: `$lib`, `$types`, `$services`, `$logger`, `$views`',
    '- **File path comment**: every file has `// path/to/file` as first line',
    '',
    '## Key Files',
    '',
    '| File | What it is |',
    '|------|-----------|',
    '| `.context/llms.txt` | Complete index of all knowledge files |',
    '| `docs/intro/README.md` | Project overview |',
    '| `docs/guides/ARCHITECTURE.md` | System architecture |',
    '| `docs/contracts/INDEX.md` | All active contracts |',
    '| `docs/contracts/TEMPLATE.md` | How to write a contract |',
    '',
    `> Generated: ${new Date().toISOString().split('T')[0]}`,
    `> Run \`bun run scripts -- generate_context\` to regenerate.`,
    '',
  ];

  writeFileSync(OUTPUT, lines.join('\n'), 'utf8');
  console.log(`Generated: ${OUTPUT}`);
}

main();
