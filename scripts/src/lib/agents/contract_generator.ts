// scripts/src/lib/agents/contract_generator.ts
/**
 * Automated Backlog Contract Generator (C-310).
 *
 * Reads raw feature outlines from TODO.md, converts them into fully formatted
 * engineering contracts matching docs/contracts/TEMPLATE.md structure, and
 * updates docs/contracts/INDEX.md with the new entries.
 *
 * Usage:
 *   bun run scripts/src/lib/agents/contract_generator.ts --target C-ME-002
 *   bun run scripts/src/lib/agents/contract_generator.ts --scan
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

// ── Types ──────────────────────────────────────────────────

/** A backlog item extracted from TODO.md. */
export type TodoBacklogItem = {
  /** Display tier identifier from section header */
  tierIdentifier: string;
  /** Generated feature code (e.g. C-ME-002) */
  featureCode: string;
  /** Title string from the heading */
  titleString: string;
  /** Raw bullet points under the heading */
  rawBulletPoints: string[];
  /** Output file path */
  targetFilePath: string;
};

/** Metadata about a generated contract. */
export type GeneratedContractMetadata = {
  contractNumber: string;
  fileNameKey: string;
  resolvedDependencies: string[];
  priorityLevel: 'P0' | 'P1' | 'P2';
};

// ── Constants ──────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const TODO_PATH = resolve(PROJECT_ROOT, 'TODO.md');
const CONTRACTS_DIR = resolve(PROJECT_ROOT, 'docs', 'contracts');
const INDEX_PATH = resolve(CONTRACTS_DIR, 'INDEX.md');

// ── TODO.md parsing ────────────────────────────────────────

/**
 * Parse TODO.md into structured backlog items.
 *
 * Recognizes patterns:
 *   ### N. Title String
 *   - bullet points
 *
 * Sections are:
 *   ## 🚧 In Progress / Needs Polish  → P1
 *   ## 📋 Backlog → P2
 *   ## ✅ Completed → P0 (skip — already done)
 */
const _parseTodoBacklog = (): TodoBacklogItem[] => {
  if (!existsSync(TODO_PATH)) {
    return [];
  }

  const content = readFileSync(TODO_PATH, 'utf-8');
  const items: TodoBacklogItem[] = [];

  // Split into sections
  const sections = content.split(/(?=^## )/m);
  let counter = 0;

  for (const section of sections) {
    // Determine priority tier
    let tierLabel = 'P1';

    if (/in.progress|needs.polish/i.test(section)) {
      tierLabel = 'P1';
    } else if (/backlog|planned|upcoming/i.test(section)) {
      tierLabel = 'P2';
    } else if (/completed|done/i.test(section)) {
      // Skip completed items
      continue;
    }

    // Extract numbered items with their bullet lists
    const itemPattern = /###\s+(\d+)\.\s+(.+?)(?=\n###|\n##|$)/gs;
    let match: RegExpExecArray | null;

    while (true) {
      match = itemPattern.exec(section);
      if (match === null) {
        break;
      }

      const itemTitle = match[2].trim();
      const itemBody = match[0];

      // Extract bullet points
      const bulletLines: string[] = [];
      const bulletPattern = /^\s*-\s+(.+)/gm;
      let bulletMatch: RegExpExecArray | null;

      while (true) {
        bulletMatch = bulletPattern.exec(itemBody);
        if (bulletMatch === null) {
          break;
        }
        bulletLines.push(bulletMatch[1].trim());
      }

      // Generate feature code
      counter++;
      const featureCode = `C-${tierLabel}-${String(counter).padStart(3, '0')}`;

      // Generate file name from title
      const fileNameKey = itemTitle
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 60)
        .replace(/-$/, '');

      const targetFilePath = resolve(CONTRACTS_DIR, `${featureCode}-${fileNameKey}.md`);

      items.push({
        tierIdentifier: tierLabel,
        featureCode,
        titleString: itemTitle,
        rawBulletPoints: bulletLines,
        targetFilePath,
      });
    }
  }

  return items;
};

// ── Template filling ───────────────────────────────────────

/**
 * Fill the contract template with extracted data.
 */
const _fillTemplate = (item: TodoBacklogItem): string => {
  // Extract dependencies from bullet points
  const deps = _inferDependencies(item.rawBulletPoints);

  // Build the contract content
  const contractContent = `# Contract ${item.featureCode}: ${item.titleString}

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — ${item.tierIdentifier} tier backlog item |
| **Target** | {path} — {brief description} |
| **Priority** | ${item.tierIdentifier} — {one-line justification} |
| **Dependencies** | ${deps.length > 0 ? deps.join(', ') : '—'} |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

${item.rawBulletPoints.length > 0 ? item.rawBulletPoints[0] : item.titleString}

## Design Reference

{Existing patterns in the repo to follow. Reference specific files, packages, or previous contracts.}

## Architecture Directives

{Use domain-level names and logical paths. Let Pi decide exact file placement based on its aikami-conventions skill.}

## State & Data Models

{Describe the data shape conceptually. STRICTLY FORBIDDEN to write framework boilerplate.}

## Scope Boundaries

- **In Scope:** {Bullet list}
- **Out of Scope:** {Bullet list}

## Acceptance Criteria

### AC-1: {Scenario Name}
**Given** {precondition}
**When** {action}
**Then** {expected outcome}

**Test Hooks**:
- Moon Task: {command}
- Integration: N/A
- E2E / Visual: N/A

## Implementation Sequence
1. **Phase 1 (Data/Logic)**: {first phase}
2. **Phase 2 (Integration)**: {second phase}
3. **Phase 3 (Validation)**: Run \`validate()\` and specific Moon tasks

## Edge Cases & Gotchas
- **{Scenario}**: {handling}

---

<!-- Generated by contract_generator.ts (C-310) from TODO.md -->
`;
  return contractContent;
};

/**
 * Infer dependency contracts from feature description and bullet points.
 */
const _inferDependencies = (bulletPoints: string[]): string[] => {
  const deps = new Set<string>();
  const allText = bulletPoints.join(' ').toLowerCase();

  // Map keywords to known contract dependencies
  const depMap: Record<string, string> = {
    firebase: 'C-014',
    database: 'C-014',
    dataconnect: 'C-014',
    'data connect': 'C-014',
    ai: 'C-015',
    llm: 'C-015',
    openai: 'C-015',
    gemini: 'C-015',
    game: 'C-016',
    engine: 'C-016',
    pixi: 'C-016',
    canvas: 'C-016',
    ecs: 'C-016',
    bit: 'C-016',
    svelte: 'C-009',
    viewmodel: 'C-120',
    'view model': 'C-120',
    view: 'C-120',
    sandbox: 'C-139',
    route: 'C-119',
    routing: 'C-119',
    auth: 'C-121',
    authentication: 'C-121',
    onboarding: 'C-122',
    character: 'C-123',
    combat: 'C-144',
    dialogue: 'C-128',
    npc: 'C-141',
    inventory: 'C-142',
    quest: 'C-143',
    audio: 'C-150',
    music: 'C-151',
    save: 'C-132',
    load: 'C-132',
    persist: 'C-132',
    swarm: 'C-300',
    agent: 'C-300',
    'convention gate': 'C-304',
    convention: 'C-304',
    lint: 'C-304',
    visual: 'C-181',
    test: 'C-011',
    token: 'C-301',
    router: 'C-301',
    cache: 'C-302',
    scratchpad: 'C-302',
  };

  for (const [keyword, contract] of Object.entries(depMap)) {
    if (allText.includes(keyword)) {
      deps.add(contract);
    }
  }

  return [...deps].sort();
};

// ── INDEX.md updater ───────────────────────────────────────

/**
 * Update INDEX.md to include a new contract entry.
 *
 * AC-2: Contract Index Synchronization
 * - Appends item to correct priority table
 * - Preserves existing checkmark indicators
 */
const _updateIndex = (item: TodoBacklogItem, deps: string[]): void => {
  if (!existsSync(INDEX_PATH)) {
    console.warn('[contract-generator] INDEX.md not found');
    return;
  }

  let indexContent = readFileSync(INDEX_PATH, 'utf-8');

  const fileName = relative(CONTRACTS_DIR, item.targetFilePath);

  // Build the new row
  const depList = deps.length > 0 ? deps.join(', ') : '—';
  const newRow = `| ${item.featureCode} | [${item.titleString}](${fileName}) 🔴 | ${item.rawBulletPoints.slice(0, 2).join('; ') || item.titleString} | ${depList} |`;

  // Find the correct section to insert into (P1 or P2)
  const sectionHeader =
    item.tierIdentifier === 'P1'
      ? '### 🟡 P1 — Structure & Configuration'
      : '### 🔵 P2 — Quality of Life';

  const sectionRegex = new RegExp(`(${sectionHeader}[^#]*)`, 'g');

  const match = sectionRegex.exec(indexContent);
  if (!match) {
    console.warn(`[contract-generator] Could not find section ${sectionHeader} in INDEX.md`);
    return;
  }

  // Find the last row in the section and append after it
  const sectionContent = match[1];
  const lastRowMatch = sectionContent.match(/\| C-[\w-]+.*\|[\s\S]*?\n(?=\n##|\n###|$)/g);
  if (lastRowMatch) {
    const lastRow = lastRowMatch[lastRowMatch.length - 1];
    const updatedSection = sectionContent.replace(lastRow, `${lastRow.trim()}\n${newRow}\n`);
    indexContent = indexContent.replace(sectionContent, updatedSection);
  } else {
    // No rows in section — insert after header
    const updatedSection = sectionContent.replace(sectionHeader, `${sectionHeader}\n${newRow}\n`);
    indexContent = indexContent.replace(sectionContent, updatedSection);
  }

  writeFileSync(INDEX_PATH, indexContent);
};

// ── Public API ─────────────────────────────────────────────

/**
 * Scan TODO.md and generate contract files for all unprocessed items.
 */
export const scanAndGenerate = (): GeneratedContractMetadata[] => {
  const items = _parseTodoBacklog();
  const generated: GeneratedContractMetadata[] = [];

  if (items.length === 0) {
    console.log('[contract-generator] No backlog items found in TODO.md');
    return [];
  }

  console.log(`[contract-generator] Found ${items.length} backlog item(s)`);

  if (!existsSync(CONTRACTS_DIR)) {
    mkdirSync(CONTRACTS_DIR, { recursive: true });
  }

  for (const item of items) {
    // Skip if file already exists
    if (existsSync(item.targetFilePath)) {
      console.log(`[contract-generator] Skipping existing: ${item.featureCode}`);
      continue;
    }

    const contractContent = _fillTemplate(item);
    writeFileSync(item.targetFilePath, contractContent);

    const deps = _inferDependencies(item.rawBulletPoints);

    console.log(
      `[contract-generator] Generated: ${item.featureCode} → ${relative(CONTRACTS_DIR, item.targetFilePath)}`,
    );

    generated.push({
      contractNumber: item.featureCode,
      fileNameKey: relative(CONTRACTS_DIR, item.targetFilePath),
      resolvedDependencies: deps,
      priorityLevel: item.tierIdentifier as 'P1' | 'P2',
    });
  }

  return generated;
};

/**
 * Generate a single contract from a specific TODO.md feature code.
 */
export const generateSingle = (featureCode: string): GeneratedContractMetadata | null => {
  const items = _parseTodoBacklog();
  const item = items.find((i) => i.featureCode === featureCode);

  if (!item) {
    console.error(`[contract-generator] Feature code "${featureCode}" not found in TODO.md`);
    return null;
  }

  const contractContent = _fillTemplate(item);
  writeFileSync(item.targetFilePath, contractContent);

  const deps = _inferDependencies(item.rawBulletPoints);

  // Update INDEX.md
  _updateIndex(item, deps);

  console.log(`[contract-generator] Generated: ${item.featureCode}`);

  return {
    contractNumber: item.featureCode,
    fileNameKey: relative(CONTRACTS_DIR, item.targetFilePath),
    resolvedDependencies: deps,
    priorityLevel: item.tierIdentifier as 'P1' | 'P2',
  };
};

// ── CLI ────────────────────────────────────────────────────

const main = (): void => {
  const args = process.argv.slice(2);

  if (args.includes('--scan')) {
    const results = scanAndGenerate();
    console.log(`\n[contract-generator] Done — ${results.length} contract(s) generated`);
    process.exit(0);
  }

  const targetIdx = args.indexOf('--target');
  const target = targetIdx !== -1 ? args[targetIdx + 1] : undefined;

  if (!target) {
    console.error('Usage: bun run contract_generator.ts --target <FEATURE-CODE>');
    console.error('       bun run contract_generator.ts --scan');
    process.exit(1);
  }

  generateSingle(target);
};

main();
