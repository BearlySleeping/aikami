// scripts/src/lib/generate_context.ts
/**
 * Generate knowledge/CONTEXT.md from project metadata.
 * Reads moon projects, tsconfig, and package.json to build the AI briefing.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../../..');
const KNOWLEDGE_DIR = join(ROOT, 'knowledge');
const OUTPUT = join(KNOWLEDGE_DIR, 'CONTEXT.md');

async function main() {
  console.log('Generating CONTEXT.md...');

  // Read project metadata
  const pkgJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  const projects = [
    { name: 'PWA', path: 'apps/frontend/pwa', desc: 'Main Progressive Web App (SvelteKit 2, Svelte 5)' },
    { name: 'Landing', path: 'apps/frontend/landing_page', desc: 'Public landing page' },
    { name: 'Docs', path: 'apps/frontend/docs', desc: 'Documentation site (Astro)' },
    { name: 'GameJS', path: 'apps/frontend/gamejs', desc: 'GodotJS game (TypeScript)' },
    { name: 'Functions', path: 'apps/backend/functions', desc: 'Firebase Cloud Functions' },
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
  let contractsIndex = '';
  try {
    contractsIndex = readFileSync(join(KNOWLEDGE_DIR, 'contracts/INDEX.md'), 'utf8');
  } catch {
    contractsIndex = '';
  }

  const lines = [
    '# Aikami — AI Briefing',
    '',
    '> **Read this first.** A 2-page summary for any AI tool (pi, Claude, Gemini).',
    '> Pair with `llms.txt` for the full file index.',
    '',
    '---',
    '',
    '## What We\'re Building',
    '',
    'Aikami is a monorepo application platform: SvelteKit PWA + Firebase backend + Bun runtime.',
    '',
    '| Component | Technology |',
    '|-----------|-----------|',
    '| PWA | SvelteKit 2, Svelte 5 (runes) |',
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
    '| Frontend (PWA) | SvelteKit 2, Svelte 5 Runes |',
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
    '| `knowledge/llms.txt` | Complete index of all knowledge files |',
    '| `knowledge/intro/README.md` | Project overview |',
    '| `knowledge/guides/ARCHITECTURE.md` | System architecture |',
    '| `knowledge/contracts/INDEX.md` | All active contracts |',
    '| `knowledge/contracts/TEMPLATE.md` | How to write a contract |',
    '',
    `> Generated: ${new Date().toISOString().split('T')[0]}`,
    `> Run \`bun run scripts -- generate_context\` to regenerate.`,
    '',
  ];

  writeFileSync(OUTPUT, lines.join('\n'), 'utf8');
  console.log(`Generated: ${OUTPUT}`);
}

main();
