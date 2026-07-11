/**
 * Canonical backlog parser for docs/TODO.md.
 *
 * Single source of truth used by both CLI/scripts and Pi extensions.
 * Parses stable explicit headings (`### C-312 — Title`) with structured
 * field lines (`- **Field:** value`).
 *
 * DO NOT create a parallel parser elsewhere. This is the canonical one.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Types ──────────────────────────────────────────────────

export type BacklogStatus = 'not_started' | 'in_progress' | 'blocked' | 'completed';
export type BacklogPriority = 'P0' | 'P1' | 'P2';

/** A single parsed backlog item from docs/TODO.md */
export type BacklogItem = {
  /** Stable ID, e.g. "C-312" */
  id: string;
  /** Full title after the em-dash, e.g. "Restore Planning, Promotion, and Release Truth" */
  title: string;
  /** Section header from TODO.md (e.g. "Phase 1 — Playable, Polished, Offline-Capable Vertical Slice") */
  phase: string;
  /** Current status */
  status: BacklogStatus;
  /** Priority tier */
  priority: BacklogPriority;
  /** Primary architectural target */
  target: string;
  /** Expected outcome */
  outcome: string;
  /** Scope description */
  scope: string;
  /** Comma-separated dependency IDs (e.g. "C-310, C-304") */
  dependencies: string;
  /** Acceptance gate (seed for Given/When/Then) */
  acceptanceGate: string;
  /** Raw references string */
  references: string;
  /** Whether a contract file already exists for this ID */
  alreadyGenerated: boolean;
  /** Path to existing contract file, if any */
  existingContractPath: string | null;
  /** Whether the existing contract is in the archived directory */
  isArchived: boolean;
  /** Raw bullet field map (field name → value) for extensibility */
  rawFields: Record<string, string>;
};

/** Parsed TODO.md document */
export type BacklogDocument = {
  /** File path */
  path: string;
  /** All parsed items */
  items: BacklogItem[];
  /** Errors encountered during parsing */
  errors: string[];
};

// ── Constants ──────────────────────────────────────────────

const TODO_PATH = 'docs/TODO.md';
const CONTRACTS_DIR = 'docs/contracts';
const ARCHIVED_CONTRACTS_DIR = 'docs/contracts/archived';

// ── Helpers ────────────────────────────────────────────────

/**
 * Parse a single bullet field from a markdown line.
 * Format: "- **Field:** value"
 */
const parseFieldValue = (line: string): { field: string; value: string } | null => {
  const match = line.match(/^-\s+\*\*(.+?):\*\*\s*(.+)/);
  if (!match) {
    return null;
  }
  return { field: (match[1] ?? '').trim(), value: (match[2] ?? '').trim() };
};

/**
 * Find the title from a heading line.
 * Format: "### C-312 — Title Here"
 */
const parseHeading = (line: string): { id: string; title: string } | null => {
  const match = line.match(/^###\s+(C-\d+|MIG-\d+)\s+[–—-]\s+(.+)/);
  if (!match) {
    return null;
  }
  return { id: match[1] ?? '', title: (match[2] ?? '').trim() };
};

/**
 * Find an existing contract file by ID prefix match.
 * Checks active directory first, then falls back to archived/.
 * e.g. "C-312" matches "C-312-restore-planning-promotion-and-release-truth.md"
 *
 * Returns { path, isArchived } or null.
 */
const findExistingContract = (
  activeDir: string,
  archivedDir: string,
  id: string,
): { path: string; isArchived: boolean } | null => {
  // Check active directory first
  try {
    const activeFiles = readdirSync(activeDir);
    const activeMatch = activeFiles.find(
      (f) => f.startsWith(`${id}-`) && f.endsWith('.md') && f !== 'TEMPLATE.md',
    );
    if (activeMatch) {
      return { path: activeMatch, isArchived: false };
    }
  } catch {
    // ignore
  }

  // Fall back to archived/
  try {
    const archivedFiles = readdirSync(archivedDir);
    const archivedMatch = archivedFiles.find(
      (f) => f.startsWith(`${id}-`) && f.endsWith('.md'),
    );
    if (archivedMatch) {
      return { path: archivedMatch, isArchived: true };
    }
  } catch {
    // ignore
  }

  return null;
};

// ── Parser ─────────────────────────────────────────────────

/**
 * Parse docs/TODO.md into structured backlog items.
 *
 * @param repoRoot — Absolute path to the monorepo root
 * @returns Parsed document with items and errors
 */
export const parseBacklog = (repoRoot: string): BacklogDocument => {
  const errors: string[] = [];
  const items: BacklogItem[] = [];
  const seenIds = new Set<string>();

  const todoPath = join(repoRoot, TODO_PATH);
  const contractsDir = join(repoRoot, CONTRACTS_DIR);
  const archivedContractsDir = join(repoRoot, ARCHIVED_CONTRACTS_DIR);

  if (!existsSync(todoPath)) {
    errors.push(`Backlog file not found: ${todoPath}`);
    return { path: todoPath, items: [], errors };
  }

  const content = readFileSync(todoPath, 'utf-8');

  // Split into sections by ## and # Phase headings to track phase context
  const sections = content.split(/^(?=(?:## |# Phase ))/m);
  let currentPhase = '';

  // Track phase context from ## headings, but parse items in all sections
  for (const section of sections) {
    const lines = section.split('\n');

    // Track phase context when we encounter a ## heading or # Phase heading
    if (lines[0]?.startsWith('## ')) {
      currentPhase = (lines[0] ?? '').replace(/^##\s+/, '').trim();
    } else if (/^#\s+Phase\s+\d/.test(lines[0] ?? '')) {
      currentPhase = (lines[0] ?? '').replace(/^#\s+/, '').trim();
    }

    // Parse individual ### C-XXX items within every section
    let currentItemLines: string[] = [];
    let currentHeading: { id: string; title: string } | null = null;
    let inItem = false;

    for (const line of lines) {
      const heading = parseHeading(line);

      if (heading) {
        // Commit previous item
        if (inItem && currentHeading) {
          const item = buildItem(
            currentHeading.id,
            currentHeading.title,
            currentPhase,
            currentItemLines,
            contractsDir,
            archivedContractsDir,
          );
          if (seenIds.has(item.id)) {
            errors.push(`Duplicate ID: ${item.id}`);
          } else {
            seenIds.add(item.id);
            items.push(item);
          }
        }

        // Start new item
        currentHeading = heading;
        currentItemLines = [];
        inItem = true;
        continue;
      }

      if (inItem) {
        currentItemLines.push(line);
      }
    }

    // Commit final item in section
    if (inItem && currentHeading) {
      const item = buildItem(
        currentHeading.id,
        currentHeading.title,
        currentPhase,
        currentItemLines,
        contractsDir,
        archivedContractsDir,
      );
      if (seenIds.has(item.id)) {
        errors.push(`Duplicate ID: ${item.id}`);
      } else {
        seenIds.add(item.id);
        items.push(item);
      }
    }
  }

  return { path: todoPath, items, errors };
};

/**
 * Build a single BacklogItem from parsed heading and body lines.
 */
const buildItem = (
  id: string,
  title: string,
  phase: string,
  lines: string[],
  contractsDir: string,
  archivedContractsDir: string,
): BacklogItem => {
  const rawFields: Record<string, string> = {};

  for (const line of lines) {
    const parsed = parseFieldValue(line);
    if (parsed) {
      rawFields[parsed.field] = parsed.value;
    }
  }

  const get = (fieldName: string): string =>
    rawFields[fieldName] ?? rawFields[fieldName.toLowerCase()] ?? '';

  // Check for existing contract (active first, then archived)
  const existing = findExistingContract(contractsDir, archivedContractsDir, id);

  return {
    id,
    title,
    phase,
    status: normalizeStatus(get('Status')),
    priority: normalizePriority(get('Priority')),
    target: get('Target'),
    outcome: get('Outcome'),
    scope: get('Scope'),
    dependencies: get('Dependencies'),
    acceptanceGate: get('Acceptance gate'),
    references: get('References'),
    alreadyGenerated: existing !== null,
    existingContractPath: existing?.path ?? null,
    isArchived: existing?.isArchived ?? false,
    rawFields,
  };
};

// ── Normalizers ────────────────────────────────────────────

const normalizeStatus = (raw: string): BacklogStatus => {
  const lower = raw.toLowerCase();
  if (lower.includes('in_progress') || lower.includes('in progress')) {
    return 'in_progress';
  }
  if (lower.includes('blocked')) {
    return 'blocked';
  }
  if (lower.includes('completed') || lower.includes('done')) {
    return 'completed';
  }
  return 'not_started';
};

const normalizePriority = (raw: string): BacklogPriority => {
  const match = raw.match(/P[012]/);
  if (match) {
    return match[0] as BacklogPriority;
  }
  return 'P2';
};

// ── CLI ────────────────────────────────────────────────────

if (import.meta.main) {
  const repoRoot = join(import.meta.dir, '../../../..');
  const result = parseBacklog(repoRoot);

  console.log(`📋 Parsed ${result.items.length} items from ${TODO_PATH}`);
  console.log(`⚠️ ${result.errors.length} errors`);

  for (const item of result.items.slice(0, 5)) {
    console.log(`\n  ${item.id}: ${item.title}`);
    console.log(`    Status: ${item.status} | Priority: ${item.priority}`);
    console.log(`    Phase: ${item.phase}`);
    console.log(`    Contract: ${item.existingContractPath ?? 'not generated'}`);
  }

  if (result.errors.length > 0) {
    console.log('\n❌ Errors:');
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
  }
}
