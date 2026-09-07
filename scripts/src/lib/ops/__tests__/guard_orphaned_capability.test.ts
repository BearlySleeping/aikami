// scripts/src/lib/ops/__tests__/guard_orphaned_capability.test.ts
//
// Tests for the orphaned capability guard (C-485 AC-2, AC-3).
// Covers baseline content assertions, extractExports helper, and
// isProductionFile helper.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractExports,
  extractSvelteCode,
  isProductionFile,
} from '../guard_orphaned_capability.ts';

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
    expect(entry.orphaned).toContain('AutonomousMessageService.selectGroupParticipants');
    expect(entry.orphaned).toContain('AutonomousMessageService.generateMultiNpcResponses');
  });
});

// ── isProductionFile helper tests ───────────────────────────

describe('production file detection', () => {
  test('service file is production', () => {
    expect(isProductionFile('apps/frontend/client/src/lib/services/foo_service.svelte.ts')).toBe(
      true,
    );
  });

  test('test file is not production', () => {
    expect(isProductionFile('apps/frontend/client/src/lib/services/foo_service.test.ts')).toBe(
      false,
    );
  });

  test('spec file is not production', () => {
    expect(isProductionFile('apps/frontend/client/src/lib/services/foo_service.spec.ts')).toBe(
      false,
    );
  });

  test('file in __tests__ is not production', () => {
    expect(isProductionFile('apps/frontend/client/src/lib/services/__tests__/foo.test.ts')).toBe(
      false,
    );
  });

  test('declaration file is not production', () => {
    expect(isProductionFile('apps/frontend/client/src/lib/services/foo.d.ts')).toBe(false);
  });

  test('e2e file is not production', () => {
    expect(isProductionFile('apps/e2e/tests/client/foo.spec.ts')).toBe(false);
  });

  test('svelte view file is production', () => {
    expect(isProductionFile('apps/frontend/client/src/lib/views/feature/feature_view.svelte')).toBe(
      true,
    );
  });

  test('view model file is production', () => {
    expect(
      isProductionFile('apps/frontend/client/src/lib/views/feature/feature_view_model.svelte.ts'),
    ).toBe(true);
  });
});

describe('extractExports', () => {
  test('includes public methods from an exported service class', () => {
    const exports = extractExports(`
      export class ExampleService {
        public selectGroupParticipants() {}
        async generateMultiNpcResponses() {}
        protected internalHook() {}
        private secret() {}
      }
    `);

    expect(exports).toContain('ExampleService');
    expect(exports).toContain('ExampleService.selectGroupParticipants');
    expect(exports).toContain('ExampleService.generateMultiNpcResponses');
    expect(exports).not.toContain('ExampleService.internalHook');
    expect(exports).not.toContain('ExampleService.secret');
  });

  test('includes methods from a class exposed through an exported singleton', () => {
    const exports = extractExports(`
      class ExampleService {
        run() {}
      }
      export const exampleService: ExampleService =
        ExampleService.create({}) as ExampleService;
    `);

    expect(exports).toContain('exampleService');
    expect(exports).toContain('ExampleService.run');
  });
});

describe('extractSvelteCode', () => {
  test('keeps scripts and template expressions but excludes comments and visible text', () => {
    const code = extractSvelteCode(`
      <script lang="ts">const service = getService();</script>
      <!-- service.commentOnlyMethod() -->
      <p>service.visibleTextOnlyMethod()</p>
      <button onclick={() => service.actualMethod()}>Run</button>
    `);

    expect(code).toContain('getService');
    expect(code).toContain('actualMethod');
    expect(code).not.toContain('commentOnlyMethod');
    expect(code).not.toContain('visibleTextOnlyMethod');
  });
});
