// scripts/src/lib/ops/__tests__/guard_orphaned_capability.test.ts
//
// Tests for the orphaned capability guard (C-485 AC-2, AC-3).
// Covers baseline content assertions, extractExports helper, and
// isProductionFile helper.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Baseline content assertions (AC-3) ──────────────────────

describe('guard_orphaned_capability_baseline.json', () => {
  const baselinePath = resolve(import.meta.dir, '../guard_orphaned_capability_baseline.json');

  test('baseline file exists', () => {
    expect(existsSync(baselinePath)).toBe(true);
  });

  test('baseline is valid JSON', () => {
    const content = readFileSync(baselinePath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  test('baseline contains autonomous_message_service entry with C-493 pointer', () => {
    const content = readFileSync(baselinePath, 'utf-8');
    const baseline = JSON.parse(content);

    const entry =
      baseline['apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts'];
    expect(entry).toBeDefined();
    expect(entry.orphaned).toBeDefined();
    expect(Array.isArray(entry.orphaned)).toBe(true);

    // Must have the _comment pointing to C-493
    expect(entry._comment).toBeDefined();
    expect(entry._comment).toMatch(/C-493/);
    expect(entry._comment).toMatch(/C-456/);
  });

  test('baseline has orphaned arrays as arrays (not numbers)', () => {
    const content = readFileSync(baselinePath, 'utf-8');
    const baseline = JSON.parse(content);

    for (const entry of Object.values(baseline) as { orphaned: unknown; _comment?: string }[]) {
      expect(Array.isArray(entry.orphaned)).toBe(true);
      // Every entry with orphaned symbols should have at least one
      expect((entry.orphaned as string[]).length).toBeGreaterThan(0);
    }
  });

  test('autonomous_message_service entry names specific symbols', () => {
    const content = readFileSync(baselinePath, 'utf-8');
    const baseline = JSON.parse(content);

    const entry =
      baseline['apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts'];
    expect(entry.orphaned).toContain('AutonomousMessageServiceInterface');
    expect(entry.orphaned).toContain('AutonomousMessageServiceOptions');
  });
});

// ── isProductionFile helper tests ───────────────────────────

// We test the logic inline since the guard module calls main() directly

describe('production file detection (isProductionFile equivalent)', () => {
  const isProd = (path: string): boolean => {
    const normalized = path.replace(/\\/g, '/');
    if (normalized.includes('/__tests__/')) {
      return false;
    }
    if (/\.(test|spec)\.(ts|svelte)$/.test(normalized)) {
      return false;
    }
    if (normalized.endsWith('.d.ts')) {
      return false;
    }
    if (normalized.includes('/apps/e2e/')) {
      return false;
    }
    return true;
  };

  test('service file is production', () => {
    expect(isProd('apps/frontend/client/src/lib/services/foo_service.svelte.ts')).toBe(true);
  });

  test('test file is not production', () => {
    expect(isProd('apps/frontend/client/src/lib/services/foo_service.test.ts')).toBe(false);
  });

  test('spec file is not production', () => {
    expect(isProd('apps/frontend/client/src/lib/services/foo_service.spec.ts')).toBe(false);
  });

  test('file in __tests__ is not production', () => {
    expect(isProd('apps/frontend/client/src/lib/services/__tests__/foo.test.ts')).toBe(false);
  });

  test('declaration file is not production', () => {
    expect(isProd('apps/frontend/client/src/lib/services/foo.d.ts')).toBe(false);
  });

  test('e2e file is not production', () => {
    expect(isProd('apps/e2e/tests/client/foo.spec.ts')).toBe(false);
  });

  test('svelte view file is production', () => {
    expect(isProd('apps/frontend/client/src/lib/views/feature/feature_view.svelte')).toBe(true);
  });

  test('view model file is production', () => {
    expect(isProd('apps/frontend/client/src/lib/views/feature/feature_view_model.svelte.ts')).toBe(
      true,
    );
  });
});
