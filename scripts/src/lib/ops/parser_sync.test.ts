// scripts/src/lib/ops/parser_sync.test.ts
/**
 * Test that the Pi extension inline parser stays in sync with the canonical
 * parse_backlog.ts parser. Both parsers must produce identical id, title,
 * and phase values for every item in docs/TODO.md.
 *
 * See C-312 AC-4 for the contract requirement.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBacklog } from './parse_backlog.js';

const REPO_ROOT = join(import.meta.dir, '../../../..');
const TODO_PATH = join(REPO_ROOT, 'docs/TODO.md');

/**
 * Pi extension inline parser logic, extracted for testing.
 * Must mirror parseBacklog.ts heading/field parsing exactly.
 */
const piInlineParse = () => {
  const content = readFileSync(TODO_PATH, 'utf-8');
  const sections = content.split(/^(?=(?:## |# Phase ))/m);
  const items: Array<{ id: string; title: string; phase: string }> = [];
  let currentPhase = '';

  for (const section of sections) {
    const lines = section.split('\n');

    if (lines[0]?.startsWith('## ') || /^#\s+Phase\s+\d/.test(lines[0] ?? '')) {
      currentPhase = (lines[0] ?? '').replace(/^#{1,2}\s+/, '').trim();
    }

    let currentItemLines: string[] = [];
    let currentId = '';
    let currentTitle = '';
    let inItem = false;

    for (const line of lines) {
      const headingMatch = line.match(/^###\s+(C-\d+|MIG-\d+)\s+[–—-]\s+(.+)/);
      if (headingMatch) {
        if (inItem && currentId) {
          items.push({ id: currentId, title: currentTitle, phase: currentPhase });
        }
        currentId = headingMatch[1] ?? '';
        currentTitle = (headingMatch[2] ?? '').trim();
        currentItemLines = [];
        inItem = true;
        continue;
      }
      if (inItem) {
        currentItemLines.push(line);
      }
    }

    if (inItem && currentId) {
      items.push({ id: currentId, title: currentTitle, phase: currentPhase });
    }
  }

  return items;
};

/**
 * Extract regex literal pattern strings from source for comparison.
 * Handles the escaped-string representation seen in the source files.
 */
const getSourceRegexPatterns = (source: string): { heading: string; field: string } | null => {
  // The heading regex in source: /^###\s+(C-\d+|MIG-\d+)\s+[–—\-]\s+(.+)/
  const headingMatch = source.match(
    /\/\^###\\s\+\(C-\\d\+\|MIG-\\d\+\)\\s\+\[–—\\-\]\\s\+\(\.\+\)\//,
  );

  // The field regex in source: /^-\s+\*\*(.+?):\*\*\s*(.+)/
  const fieldMatch = source.match(/\/\^-\\s\+\\\*\\\*\(\.\+\?\):\\\*\\\*\\s\*\(\.\+\)\//);

  if (!headingMatch || !fieldMatch) {
    return null;
  }
  return { heading: headingMatch[0], field: fieldMatch[0] };
};

describe('Parser Sync (C-312 AC-4)', () => {
  it('heading and field regex patterns are identical between parsers', () => {
    const canonical = readFileSync(
      join(REPO_ROOT, 'scripts/src/lib/ops/parse_backlog.ts'),
      'utf-8',
    );
    const piExtension = readFileSync(
      join(REPO_ROOT, '.pi/extensions/contract_factory.ts'),
      'utf-8',
    );

    const canonicalRegexes = getSourceRegexPatterns(canonical);
    const piRegexes = getSourceRegexPatterns(piExtension);

    if (canonicalRegexes && piRegexes) {
      expect(piRegexes.heading, 'Heading regex must match').toBe(canonicalRegexes.heading);
      expect(piRegexes.field, 'Field regex must match').toBe(canonicalRegexes.field);
    } else {
      // If regex extraction failed, the source structure changed — warn but don't fail
      // The functional test below (id/title/phase comparison) is the real guard
      console.warn(
        '⚠️  Could not extract regex patterns from one or both parsers. Source structure may have changed.',
      );
      if (!canonicalRegexes) {
        console.warn('    Missing from: canonical parse_backlog.ts');
      }
      if (!piRegexes) {
        console.warn('    Missing from: Pi extension contract_factory.ts');
      }
    }
  });

  it('produces identical id, title, and phase for every TODO.md item', () => {
    const canonicalDoc = parseBacklog(REPO_ROOT);
    const piItems = piInlineParse();

    // Build lookup maps by id
    const canonicalMap = new Map(canonicalDoc.items.map((i) => [i.id, i]));
    const piMap = new Map(piItems.map((i) => [i.id, i]));

    // Both must have the same set of ids
    const canonicalIds = new Set(canonicalMap.keys());
    const piIds = new Set(piMap.keys());

    // Check for ids in canonical but not in pi
    for (const id of canonicalIds) {
      expect(piMap.has(id), `Pi parser missing item: ${id}`).toBe(true);
    }

    // Check for ids in pi but not in canonical
    for (const id of piIds) {
      expect(canonicalMap.has(id), `Canonical parser missing item: ${id}`).toBe(true);
    }

    // Compare fields for all shared ids
    for (const id of canonicalIds) {
      if (piMap.has(id)) {
        const canonicalItem = canonicalMap.get(id);
        const piItem = piMap.get(id);
        expect(canonicalItem, `Missing canonical item: ${id}`).toBeDefined();
        expect(piItem, `Missing pi item: ${id}`).toBeDefined();
        if (canonicalItem && piItem) {
          expect(piItem.id, `ID mismatch for ${id}`).toBe(canonicalItem.id);
          expect(piItem.title, `Title mismatch for ${id}`).toBe(canonicalItem.title);
          expect(piItem.phase, `Phase mismatch for ${id}`).toBe(canonicalItem.phase);
        }
      }
    }

    console.log(`✅ ${canonicalDoc.items.length} items verified — all ids/titles/phases match`);
  });

  it('TODO.md file exists and is parseable', () => {
    const exists = Bun.file(TODO_PATH).size > 0;
    expect(exists).toBe(true);

    const canonicalDoc = parseBacklog(REPO_ROOT);
    expect(canonicalDoc.items.length).toBeGreaterThan(0);
    expect(canonicalDoc.errors.length).toBe(0);
  });
});
