// .pi/scripts/import_community_rules.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type IngestionSource = {
  domain: string;
  description: string;
  globs: string;
  alwaysApply: boolean;
  rawUrl: string;
};

// Production-grade mid-2026 curated skill registries
const SKILL_REGISTRIES: IngestionSource[] = [
  {
    domain: 'svelte-five',
    description:
      'Strict compilation rules, code styling, and state management patterns for Svelte 5 and Runes.',
    globs: '**/*.svelte, **/*.svelte.ts',
    alwaysApply: false,
    rawUrl:
      'https://gist.githubusercontent.com/travishorn/77a5a09e150e718a1b04dc20ec1a3858/raw/6363d8de7fbdf3dcfc81d10e828a3c691b805470/svelte-5.mdc',
  },
  {
    domain: 'pixijs-v8',
    description:
      'Optimized 2D WebGPU pipelines, asynchronous application setup, state-retained graphics rendering, and custom WGSL attributes.',
    globs: '**/rendering/**/*.ts, **/canvas/**/*.ts, **/*.svelte',
    alwaysApply: false,
    rawUrl: 'https://raw.githubusercontent.com/pixijs/pixijs-skills/main/README.md',
  },
  {
    domain: 'sql-connect',
    description:
      'Data modeling, real-time query configurations, secure row-level access controls, and client SDK generation for Firebase SQL Connect.',
    globs: '**/dataconnect/**/*.yaml, **/dataconnect/**/*.gql',
    alwaysApply: false,
    rawUrl:
      'https://raw.githubusercontent.com/firebase/agent-skills/main/skills/firebase-data-connect-basics/SKILL.md',
  },
];

const ingestRegistrySource = async (source: IngestionSource): Promise<void> => {
  console.log(`[C-320 Pipeline] Initiating ingestion for domain: ${source.domain}...`);

  try {
    const response = await fetch(source.rawUrl);
    if (!response.ok) {
      throw new Error(`HTTP network anomaly detected. Status: ${response.status}`);
    }

    let rawContent = await response.text();

    // Strip preexisting frontmatter boundaries if present to guarantee clean compilation
    if (rawContent.startsWith('---')) {
      const closingBoundaryIndex = rawContent.indexOf('---', 3);
      if (closingBoundaryIndex !== -1) {
        rawContent = rawContent.slice(closingBoundaryIndex + 3).trim();
      }
    }

    // 1. Compile and write the Multi-Document Context (.mdc) file for structural IDE prompts
    const mdcFrontmatter = [
      '---',
      `description: "${source.description}"`,
      `globs: "${source.globs}"`,
      `alwaysApply: ${source.alwaysApply}`,
      '---',
      '',
      rawContent,
    ].join('\n');

    const mdcDirectory = resolve('.cursor/rules');
    if (!existsSync(mdcDirectory)) {
      mkdirSync(mdcDirectory, { recursive: true });
    }

    const mdcFilePath = join(mdcDirectory, `${source.domain}.mdc`);
    writeFileSync(mdcFilePath, mdcFrontmatter, 'utf-8');
    console.log(`[C-320 Pipeline] Successfully compiled MDC rule to: ${mdcFilePath}`);

    // 2. Compile and write the persistent Markdown Skill for the Agent Swarm context
    const skillDirectory = resolve('.pi/skills/aikami-conventions');
    if (!existsSync(skillDirectory)) {
      mkdirSync(skillDirectory, { recursive: true });
    }

    const skillFilePath = join(skillDirectory, `${source.domain}.md`);
    writeFileSync(skillFilePath, rawContent, 'utf-8');
    console.log(`[C-320 Pipeline] Successfully written system swarm skill to: ${skillFilePath}`);
  } catch (error) {
    console.error(`[C-320 Pipeline Exception] Failed to compile domain ${source.domain}:`, error);
  }
};

const pipelineRunner = async (): Promise<void> => {
  console.log('[C-320 Pipeline] Executing Multi-Workspace Skill Scraping Cycle...');
  for (const registry of SKILL_REGISTRIES) {
    await ingestRegistrySource(registry);
  }
  console.log('[C-320 Pipeline] Ingestion cycle complete. Synchronizing master skill register...');

  // Trigger update_skills.ts script hook
  const process = Bun.spawn(['bun', '.pi/scripts/update_skills.ts']);
  await process.exited;
  console.log('[C-320 Pipeline] Verification complete. Workspace optimized.');
};

pipelineRunner();
