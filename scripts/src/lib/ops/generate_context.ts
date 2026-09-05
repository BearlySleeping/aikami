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
  ];

  const backends = [
    {
      name: 'Hub',
      path: 'apps/frontend/hub',
      desc: 'Community Hub (SvelteKit SSR → Cloudflare Worker): assets, maps, mods, personas',
    },
    { name: 'Image', path: 'apps/backend/image', desc: 'Local ComfyUI Docker microservice' },
    { name: 'Text', path: 'apps/backend/text', desc: 'Local Ollama Docker microservice' },
    { name: 'Voice', path: 'apps/backend/voice', desc: 'Local Kokoro TTS Docker microservice' },
    {
      name: 'Worker',
      path: 'apps/backend/worker',
      desc: 'Always-on VM (Discord bot, background jobs)',
    },
    { name: 'E2E', path: 'apps/e2e', desc: 'E2E test suite (Playwright + AI Visual)' },
  ];

  const libs = [
    { name: 'constants', desc: 'Shared constants, labels, registries' },
    { name: 'types', desc: 'Shared TypeScript types (derived from TypeBox)' },
    { name: 'schemas', desc: 'TypeBox validation schemas' },
    { name: 'logger', desc: 'Structured logger' },
    { name: 'utils', desc: 'Utility functions' },
    { name: 'mocks', desc: 'Test mocks and fixtures' },
    { name: 'parser', desc: 'Data parsing utilities' },
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
    'Aikami is a monorepo application platform: SvelteKit Client (PWA) + Tauri v2 desktop + Cloudflare-native backend + Bun runtime.',
    '',
    '| Component | Technology |',
    '|-----------|-----------|',
    '| Client / Game | SvelteKit 2, Svelte 5 (runes), Tauri v2, PixiJS v8 + bitECS |',
    '| Backend | Cloudflare (D1, Better Auth, R2) |',
    '| Local Store | Turso (libSQL) — offline-first source of truth |',
    '| Runtime | Bun |',
    '| Monorepo | Moon task orchestrator |',
    '| Linting | Biome |',
    '| Validation | TypeBox |',
    '| Local AI | Docker (ComfyUI, Ollama, Kokoro TTS) |',
    '',
    '## Tech Stack',
    '',
    '**Bun × SvelteKit 2 × PixiJS v8 × Turso × Cloudflare × Docker AI Microservices**',
    '',
    '| Layer | Technology |',
    '|-------|-----------|',
    '| Runtime | Bun |',
    '| Frontend (Client) | SvelteKit 2, Svelte 5 Runes, Tauri v2 |',
    '| Frontend (Hub) | SvelteKit 2 SSR on Cloudflare Worker |',
    '| Frontend (Landing) | Astro |',
    '| Frontend (Docs) | Astro |',
    '| Backend | Cloudflare D1, Better Auth, R2 |',
    '| Game Engine | PixiJS v8 + bitECS |',
    '| Local Database | Turso (libSQL) — campaigns, saves, chat |',
    '| Validation | TypeBox |',
    '| Monorepo | Moon task orchestrator |',
    '| Linting | Biome |',
    '| AI Microservices | Docker (ComfyUI, Ollama, Kokoro TTS) via herdr |',
    '',
    '## Project Structure',
    '',
    '| Project | Description |',
    '|---------|-------------|',
    ...projects.map((p) => `| ${p.name} | ${p.desc} |`),
    ...backends.map((p) => `| ${p.name} | ${p.desc} |`),
    ...libs.map((l) => `| ${l.name} | ${l.desc} |`),
    '',
    '## Project Conventions',
    '',
    'See `AGENTS.md` for full developer guidelines.',
    '',
    '### File Naming',
    '- snake_case file names (Biome enforced)',
    '- Svelte component: `+page.svelte`, `+layout.svelte`',
    '- Route directories mirror URL structure',
    '',
    '### Code Patterns',
    '- **Svelte 5 ViewModel pattern**: `+page.svelte` pure template, view model holds logic',
    '- **TypeBox schemas** in `packages/shared/schemas/`',
    '- **Turso (libSQL)** for device-local campaigns, saves, chat',
    '- **Path aliases**: `$lib`, `$types`, `$services`, `$logger`, `$views`',
    '- **File path comment**: every file has `// path/to/file` as first line',
    '',
    '## Key Files',
    '',
    '| File | What it is |',
    '|------|-----------|',
    '| `.context/llms.txt` | Complete index of all knowledge files |',
    '| `AGENTS.md` | Project overview & agent guidelines |',
    '| `docs/architecture/architecture.md` | System architecture |',
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
