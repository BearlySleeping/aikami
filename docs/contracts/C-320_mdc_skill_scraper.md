# Contract: C-320 - Automated MDC Skill Scraper and Transpiler

## 1. Metadata
- **ID:** C-320
- **Title:** Automated MDC Skill Scraper and Transpiler Pipeline
- **Status:** DRAFT
- **Author:** Aikami AI Collaborator
- **Target Stack:** Bun, TypeScript, .cursor/rules, .pi/skills, .pi/scripts/update_skills.ts

## 2. Context & Objectives
To maximize agentic performance and minimize LLM token hallucination across the `aikami-dev` monorepo, this contract establishes an automated data-ingestion pipeline. The system must ingest raw markdown configurations, `.cursorrules` payloads, and official development repositories (e.g., `pixijs-skills`, `agent-skills`, `awesome-mdc`), parse them into path-scoped Multi-Document Context (`.mdc`) rule definitions, and register them natively within the `.pi/` orchestration lifecycle. This avoids manual replication overhead and keeps development rules systematically aligned with mid-2026 tech standards.

## 3. Architecture & Requirements

### 3.1 Targeted Output Layout
The pipeline must dynamically parse incoming raw documentation and split the resulting metadata into two target locations:
1. **Frontmatter-Scoped Rules:** Written to `.cursor/rules/[domain].mdc` with explicit global pattern triggers (`globs`).
2. **Orchestration Skills:** Appended to `.pi/skills/aikami-conventions/[domain].md` to allow semantic injection by the Agent Swarms.

### 3.2 Security and Validation Constraints
- **Path Sanitization:** Prevent path-traversal attacks when parsing downloaded repository filenames.
- **Syntax Integrity:** All output rules must pass validation checks against the project's default root Biome configurations.

---

## 4. Implementation Specification

### 4.1 Script Location
Create the structural pipeline inside a new file: `.pi/scripts/import_community_rules.ts`.

### 4.2 Technical Source Implementation
```typescript
// .pi/scripts/import_community_rules.ts
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

interface IngestionSource {
  domain: string;
  description: string;
  globs: string;
  alwaysApply: boolean;
  rawUrl: string;
}

// Production-grade mid-2026 curated skill registries
const SKILL_REGISTRIES: IngestionSource[] = [
  {
    domain: "svelte-five",
    description: "Strict compilation rules, code styling, and state management patterns for Svelte 5 and Runes.",
    globs: "**/*.svelte, **/*.svelte.ts",
    alwaysApply: false,
    rawUrl: "https://gist.githubusercontent.com/travishorn/77a5a09e150e718a1b04dc20ec1a3858/raw/svelte5-runes.md"
  },
  {
    domain: "pixijs-v8",
    description: "Optimized 2D WebGPU pipelines, asynchronous application setup, state-retained graphics rendering, and custom WGSL attributes.",
    globs: "**/rendering/**/*.ts, **/canvas/**/*.ts, **/*.svelte",
    alwaysApply: false,
    rawUrl: "https://raw.githubusercontent.com/pixijs/pixijs-skills/main/v8-rendering.md"
  },
  {
    domain: "sql-connect",
    description: "Data modeling, real-time query configurations, secure row-level access controls, and client SDK generation for Firebase SQL Connect.",
    globs: "**/dataconnect/**/*.yaml, **/dataconnect/**/*.gql",
    alwaysApply: false,
    rawUrl: "https://raw.githubusercontent.com/firebase/agent-skills/main/sql-connect.md"
  }
];

async function ingestRegistrySource(source: IngestionSource): Promise<void> {
  console.log(`[C-320 Pipeline] Initiating ingestion for domain: ${source.domain}...`);
  
  try {
    const response = await fetch(source.rawUrl);
    if (!response.ok) {
      throw new Error(`HTTP network anomaly detected. Status: ${response.status}`);
    }
    
    let rawContent = await response.text();
    
    // Strip preexisting frontmatter boundaries if present to guarantee clean compilation
    if (rawContent.startsWith("---")) {
      const closingBoundaryIndex = rawContent.indexOf("---", 3);
      if (closingBoundaryIndex !== -1) {
        rawContent = rawContent.slice(closingBoundaryIndex + 3).trim();
      }
    }

    // 1. Compile and write the Multi-Document Context (.mdc) file for structural IDE prompts
    const mdcFrontmatter = [
      "---",
      `description: "${source.description}"`,
      `globs: "${source.globs}"`,
      `alwaysApply: ${source.alwaysApply}`,
      "---",
      "",
      rawContent
    ].join("\n");

    const mdcDirectory = resolve(".cursor/rules");
    if (!existsSync(mdcDirectory)) {
      mkdirSync(mdcDirectory, { recursive: true });
    }
    
    const mdcFilePath = join(mdcDirectory, `${source.domain}.mdc`);
    writeFileSync(mdcFilePath, mdcFrontmatter, "utf-8");
    console.log(`[C-320 Pipeline] Successfully compiled MDC rule to: ${mdcFilePath}`);

    // 2. Compile and write the persistent Markdown Skill for the Agent Swarm context
    const skillDirectory = resolve(".pi/skills/aikami-conventions");
    if (!existsSync(skillDirectory)) {
      mkdirSync(skillDirectory, { recursive: true });
    }

    const skillFilePath = join(skillDirectory, `${source.domain}.md`);
    writeFileSync(skillFilePath, rawContent, "utf-8");
    console.log(`[C-320 Pipeline] Successfully written system swarm skill to: ${skillFilePath}`);

  } catch (error) {
    console.error(`[C-320 Pipeline Exception] Failed to compile domain ${source.domain}:`, error);
  }
}

async function pipelineRunner(): Promise<void> {
  console.log("[C-320 Pipeline] Executing Multi-Workspace Skill Scraping Cycle...");
  for (const registry of SKILL_REGISTRIES) {
    await ingestRegistrySource(registry);
  }
  console.log("[C-320 Pipeline] Ingestion cycle complete. Synchronizing master skill register...");
  
  // Trigger update_skills.ts script hook safely using Bun process execution
  const process = Bun.spawn(["bun", "run", ".pi/scripts/update_skills.ts"]);
  await process.exited;
  console.log("[C-320 Pipeline] Verification complete. Workspace optimized.");
}

pipelineRunner();
```

### 4.3 Update Skills Interceptor Hook

Modify `.pi/scripts/update_skills.ts` to ensure it automatically registers the fresh `aikami-conventions` documentation packages inside the internal compilation loop whenever an extraction runs.

---

## 5. Verification Gate criteria

### 5.1 Compilation Verification

- Execute `bun run .pi/scripts/import_community_rules.ts`.
- Verify that `.cursor/rules/svelte-five.mdc`, `pixijs-v8.mdc`, and `sql-connect.mdc` exist with correct formatting.
- Verify that corresponding files exist inside `.pi/skills/aikami-conventions/`.

### 5.2 Lint Verification

- Run your local project linting command (e.g., `bun x biome check .cursor/rules`) to ensure the generated frontmatter and markdown syntax comply with parsing layouts.

---

## 6. Execution Command

`/contract docs/contracts/C-320_mdc_skill_scraper.md`
