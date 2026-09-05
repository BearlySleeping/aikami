// .pi/extensions/lib/output_filter.test.ts
//
// Tests for output_filter — covers DiscoveryOutcome semantics (AC-1),
// parsing, filtering, and truncation.

import { describe, expect, test } from 'bun:test';
import {
  type DiscoveryOutcome,
  extractAffectedIds,
  filterByTaskType,
  filterFixOutput,
  filterMoonRunOutput,
  filterTestOutput,
  filterTypecheckOutput,
  formatDiscoveryFailure,
  formatProjectList,
  isDiscoveryEmpty,
  isDiscoveryFailure,
  type LightProject,
  parseMoonProjects,
} from './output_filter.ts';

// ── Helpers ───────────────────────────────────────────────────────

const sampleProject = (overrides: Partial<LightProject> = {}): LightProject => ({
  id: 'test-proj',
  layer: 'application',
  source: 'apps/test',
  tags: ['test'],
  deps: [],
  ...overrides,
});

const validProjectsJson = JSON.stringify({
  projects: [
    {
      id: 'client',
      source: 'apps/frontend/client',
      config: { layer: 'application', tags: ['svelte'], dependsOn: [{ id: 'types' }] },
    },
    {
      id: 'types',
      source: 'packages/shared/types',
      config: { layer: 'library', tags: ['shared'], dependsOn: [] },
    },
  ],
});

// ── parseMoonProjects: AC-1 Discovery Outcomes ────────────────────

describe('parseMoonProjects — DiscoveryOutcome (AC-1)', () => {
  test('parses valid JSON with projects → success', () => {
    const outcome = parseMoonProjects(validProjectsJson);
    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.projects).toHaveLength(2);
      expect(outcome.projects[0]?.id).toBe('client');
      expect(outcome.projects[1]?.id).toBe('types');
    }
  });

  test('empty string → empty', () => {
    const outcome = parseMoonProjects('');
    expect(outcome.kind).toBe('empty');
  });

  test('whitespace-only → empty', () => {
    const outcome = parseMoonProjects('   \n  \t  ');
    expect(outcome.kind).toBe('empty');
  });

  test('valid JSON with empty projects array → empty', () => {
    const outcome = parseMoonProjects(JSON.stringify({ projects: [] }));
    expect(outcome.kind).toBe('empty');
  });

  test('valid JSON above 512KB cap → too_large', () => {
    // Build a string that exceeds the cap (512_000 bytes)
    const large = 'x'.repeat(600_000);
    const outcome = parseMoonProjects(large);
    expect(outcome.kind).toBe('too_large');
    if (outcome.kind === 'too_large') {
      expect(outcome.byteCount).toBe(600_000);
      expect(outcome.cap).toBe(512_000);
    }
  });

  test('multibyte JSON above 512KB cap uses UTF-8 byte length', () => {
    const large = 'é'.repeat(256_001);
    const outcome = parseMoonProjects(large);
    expect(outcome.kind).toBe('too_large');
    if (outcome.kind === 'too_large') {
      expect(outcome.byteCount).toBe(512_002);
      expect(outcome.cap).toBe(512_000);
    }
  });

  test('malformed JSON → parse_failed', () => {
    const outcome = parseMoonProjects('{not valid json}');
    expect(outcome.kind).toBe('parse_failed');
    if (outcome.kind === 'parse_failed') {
      expect(outcome.error).toBeTruthy();
    }
  });

  test('JSON missing projects array → parse_failed', () => {
    const outcome = parseMoonProjects(JSON.stringify({ error: 'not found', status: 404 }));
    expect(outcome.kind).toBe('parse_failed');
  });

  test('project without a valid ID → parse_failed', () => {
    const outcome = parseMoonProjects(
      JSON.stringify({
        projects: [
          {
            source: 'apps/frontend/client',
            config: { layer: 'application', tags: [], dependsOn: [] },
          },
        ],
      }),
    );
    expect(outcome.kind).toBe('parse_failed');
  });

  test('project with non-string tags → parse_failed', () => {
    const outcome = parseMoonProjects(
      JSON.stringify({
        projects: [
          {
            id: 'client',
            source: 'apps/frontend/client',
            config: { layer: 'application', tags: ['svelte', 42], dependsOn: [] },
          },
        ],
      }),
    );
    expect(outcome.kind).toBe('parse_failed');
  });

  test('project with malformed dependency collection → parse_failed', () => {
    const outcome = parseMoonProjects(
      JSON.stringify({
        projects: [
          {
            id: 'client',
            source: 'apps/frontend/client',
            config: { layer: 'application', tags: [], dependsOn: [{ name: 'types' }] },
          },
        ],
      }),
    );
    expect(outcome.kind).toBe('parse_failed');
  });

  test('null input → empty', () => {
    const outcome = parseMoonProjects(null as unknown as string);
    expect(outcome.kind).toBe('empty');
  });

  test('non-zero exit + valid JSON projects → still success (output is what matters)', () => {
    // The parser doesn't know about exit codes — it only sees output.
    // AC-1 says the CALLER must check exit code too.
    const outcome = parseMoonProjects(validProjectsJson);
    expect(outcome.kind).toBe('success');
  });
});

// ── isDiscoveryFailure / isDiscoveryEmpty ──────────────────────────

describe('isDiscoveryFailure / isDiscoveryEmpty', () => {
  test('success with projects → not failure, not empty', () => {
    const outcome: DiscoveryOutcome = { kind: 'success', projects: [sampleProject()] };
    expect(isDiscoveryFailure(outcome)).toBe(false);
    expect(isDiscoveryEmpty(outcome)).toBe(false);
  });

  test('empty → not failure, is empty', () => {
    const outcome: DiscoveryOutcome = { kind: 'empty' };
    expect(isDiscoveryFailure(outcome)).toBe(false);
    expect(isDiscoveryEmpty(outcome)).toBe(true);
  });

  test('empty reason → not failure, is empty', () => {
    const outcome: DiscoveryOutcome = { kind: 'empty', reason: 'No output' };
    expect(isDiscoveryFailure(outcome)).toBe(false);
    expect(isDiscoveryEmpty(outcome)).toBe(true);
  });

  test('parse_failed → is failure, not empty', () => {
    const outcome: DiscoveryOutcome = {
      kind: 'parse_failed',
      error: 'Invalid token',
      rawPreview: 'x',
    };
    expect(isDiscoveryFailure(outcome)).toBe(true);
    expect(isDiscoveryEmpty(outcome)).toBe(false);
  });

  test('too_large → is failure, not empty', () => {
    const outcome: DiscoveryOutcome = { kind: 'too_large', byteCount: 600_000, cap: 512_000 };
    expect(isDiscoveryFailure(outcome)).toBe(true);
    expect(isDiscoveryEmpty(outcome)).toBe(false);
  });

  test('command_failed → is failure, not empty', () => {
    const outcome: DiscoveryOutcome = {
      kind: 'command_failed',
      exitCode: 1,
      stderr: 'moon not found',
    };
    expect(isDiscoveryFailure(outcome)).toBe(true);
    expect(isDiscoveryEmpty(outcome)).toBe(false);
  });

  test('timeout → is failure, not empty', () => {
    const outcome: DiscoveryOutcome = { kind: 'timeout', stderr: 'killed after 30s' };
    expect(isDiscoveryFailure(outcome)).toBe(true);
    expect(isDiscoveryEmpty(outcome)).toBe(false);
  });

  test('success with empty projects array → not failure, is empty', () => {
    const outcome: DiscoveryOutcome = { kind: 'success', projects: [] };
    expect(isDiscoveryFailure(outcome)).toBe(false);
    expect(isDiscoveryEmpty(outcome)).toBe(true);
  });
});

// ── formatDiscoveryFailure ─────────────────────────────────────────

describe('formatDiscoveryFailure', () => {
  test('formats parse_failed', () => {
    const msg = formatDiscoveryFailure({
      kind: 'parse_failed',
      error: 'Unexpected token',
      rawPreview: '{bad}',
    });
    expect(msg).toContain('Unexpected token');
    expect(msg).toContain('{bad}');
  });

  test('formats too_large', () => {
    const msg = formatDiscoveryFailure({ kind: 'too_large', byteCount: 600_000, cap: 512_000 });
    expect(msg).toContain('600000');
    expect(msg).toContain('512000');
  });

  test('formats command_failed', () => {
    const msg = formatDiscoveryFailure({
      kind: 'command_failed',
      exitCode: 127,
      stderr: 'not found',
    });
    expect(msg).toContain('127');
    expect(msg).toContain('not found');
  });

  test('formats timeout', () => {
    const msg = formatDiscoveryFailure({ kind: 'timeout', stderr: 'killed after 30s' });
    expect(msg).toContain('killed after 30s');
  });

  test('returns empty for success', () => {
    const msg = formatDiscoveryFailure({ kind: 'success', projects: [sampleProject()] });
    expect(msg).toBe('');
  });
});

// ── extractAffectedIds ─────────────────────────────────────────────

describe('extractAffectedIds', () => {
  test('successful parse returns project IDs', () => {
    const outcome = extractAffectedIds(validProjectsJson);
    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.projects.map((p) => p.id)).toEqual(['client', 'types']);
    }
  });

  test('empty input returns empty success (not failure)', () => {
    const outcome = extractAffectedIds('');
    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.projects).toHaveLength(0);
    }
  });

  test('malformed input propagates the failure upward', () => {
    const outcome = extractAffectedIds('not json');
    expect(outcome.kind).toBe('parse_failed');
  });
});

// ── formatProjectList ──────────────────────────────────────────────

describe('formatProjectList', () => {
  test('empty list', () => {
    expect(formatProjectList([])).toBe('No projects.');
  });

  test('single app project', () => {
    const text = formatProjectList([
      sampleProject({ id: 'client', source: 'apps/client', layer: 'application' }),
    ]);
    expect(text).toContain('client (apps/client)');
    expect(text).toContain('Total: 1 projects');
  });

  test('app and library', () => {
    const projects = [
      sampleProject({ id: 'client', source: 'apps/client', layer: 'application' }),
      sampleProject({ id: 'types', source: 'packages/types', layer: 'library' }),
    ];
    const text = formatProjectList(projects);
    expect(text).toContain('Apps (1)');
    expect(text).toContain('Libs (1)');
    expect(text).toContain('Total: 2 projects');
  });
});

// ── filterMoonRunOutput ────────────────────────────────────────────

describe('filterMoonRunOutput', () => {
  test('null/undefined returns no output', () => {
    expect(filterMoonRunOutput(null as unknown as string)).toBe('(no output)');
  });

  test('strips progress bars and cached lines', () => {
    const input = `▮▮▮▮▮ client:build\n  (cached) client:typecheck\n  ✓ passed\n`;
    const result = filterMoonRunOutput(input);
    expect(result).not.toContain('▮▮▮▮▮');
    expect(result).not.toContain('(cached)');
    expect(result).toContain('✓ passed');
  });

  test('keeps error lines', () => {
    const input = `✓ client:build\n  error TS2345: Type 'X' is not assignable\n  ✓ done`;
    const result = filterMoonRunOutput(input);
    expect(result).toContain('error TS2345');
  });

  test('truncates large output', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const result = filterMoonRunOutput(lines.join('\n'));
    // The summary format shows "last N lines of X total" when truncated
    expect(result).toContain('Summary');
    expect(result).toContain('500 total');
  });
});

// ── filterFixOutput ────────────────────────────────────────────────

describe('filterFixOutput', () => {
  test('empty output', () => {
    expect(filterFixOutput('')).toBe('(no output)');
  });

  test('keeps fix lines', () => {
    const result = filterFixOutput('Checked 10 files\nFixed 3 issues\n  ✓ done');
    expect(result).toContain('Fixed 3 issues');
  });

  test('clean output', () => {
    expect(filterFixOutput('  ✓ all clean')).toBe('✅ No issues fixed (clean)');
  });
});

// ── filterTypecheckOutput ──────────────────────────────────────────

describe('filterTypecheckOutput', () => {
  test('empty output', () => {
    expect(filterTypecheckOutput('')).toBe('(no output)');
  });

  test('extracts TS errors', () => {
    const input = 'src/file.ts(42,5): error TS2345: Type mismatch';
    const result = filterTypecheckOutput(input);
    expect(result).toContain('1 type error');
    expect(result).toContain('TS2345');
  });

  test('clean typecheck shows last lines', () => {
    const result = filterTypecheckOutput('  ✓ all good');
    // No errors/warnings found, so it shows the non-empty lines
    expect(result).toContain('all good');
  });
});

// ── filterTestOutput ───────────────────────────────────────────────

describe('filterTestOutput', () => {
  test('empty output', () => {
    expect(filterTestOutput('')).toBe('(no output)');
  });

  test('keeps pass/fail lines', () => {
    const input = '✓ should work\n✗ should fail\n  10 passed, 2 failed';
    const result = filterTestOutput(input);
    expect(result).toContain('10 passed, 2 failed');
  });
});

// ── filterByTaskType ───────────────────────────────────────────────

describe('filterByTaskType', () => {
  test('routes fix tasks to filterFixOutput', () => {
    const result = filterByTaskType('Fixed 3 issues', 'client:fix');
    expect(result).toContain('Fixed');
  });

  test('routes typecheck tasks to filterTypecheckOutput', () => {
    const result = filterByTaskType('error TS1234: bad', 'client:typecheck');
    expect(result).toContain('TS1234');
  });

  test('routes test tasks to filterTestOutput', () => {
    const result = filterByTaskType('1 passed', 'client:test');
    expect(result).toContain('1 passed');
  });

  test('routes build tasks to filterMoonRunOutput', () => {
    const result = filterByTaskType('✓ built', 'client:build');
    expect(result).toContain('built');
  });

  test('routes unknown tasks to smartTruncate', () => {
    const result = filterByTaskType('random output', 'client:deploy');
    expect(result).toContain('random output');
  });
});
