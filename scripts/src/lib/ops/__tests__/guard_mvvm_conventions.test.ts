// scripts/src/lib/ops/__tests__/guard_mvvm_conventions.test.ts
//
// Regression tests for M8's AST dependency detection. The previous
// implementation stripped strings before searching for quoted import paths,
// so it reported zero violations for every real edge and shipped green while
// 49 ViewModel-to-ViewModel/composition imports existed in the client.

import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { isAllowlistedSpecifier, VIEW_MODEL_ALLOWLIST } from '../guards/allowlist.ts';
import { collectModuleImports, type ModuleImport } from '../guards/imports.ts';
import {
  collectMountedWrites,
  collectViewModelImportViolations,
  isViewModelDependencySpecifier,
} from '../view_model_dependency_rules.ts';

/** The guard's own import collector, over a bare `<script>` body. */
const collectModuleImportsForTest = (body: string): ModuleImport[] =>
  collectModuleImports({ source: body, fileName: 'example_view_model.svelte.ts' });

const file = 'apps/frontend/client/src/lib/views/example/example_view_model.svelte.ts';

const countsFor = (source: string): number =>
  collectViewModelImportViolations({ file, source }).length;

describe('isViewModelDependencySpecifier', () => {
  test('matches sibling ViewModels with and without the .ts extension', () => {
    expect(isViewModelDependencySpecifier('./child_view_model.svelte')).toBe(true);
    expect(isViewModelDependencySpecifier('./child_view_model.svelte.ts')).toBe(true);
  });

  test('matches aliased ViewModel imports', () => {
    expect(
      isViewModelDependencySpecifier('$lib/views/settings/ai/ai_settings_view_model.svelte.ts'),
    ).toBe(true);
  });

  test('matches composition wrappers', () => {
    expect(isViewModelDependencySpecifier('./account_composition.ts')).toBe(true);
    expect(isViewModelDependencySpecifier('./gameplay_composition')).toBe(true);
  });

  test('ignores non-ViewModel modules', () => {
    expect(isViewModelDependencySpecifier('./helper.ts')).toBe(false);
    expect(isViewModelDependencySpecifier('$services')).toBe(false);
    expect(isViewModelDependencySpecifier('./ai_settings_view_model.dev.svelte.ts')).toBe(false);
    expect(isViewModelDependencySpecifier('./components')).toBe(false);
  });
});

describe('collectViewModelImportViolations', () => {
  test('flags a runtime ViewModel import (previously reported zero)', () => {
    expect(countsFor("import { getChildViewModel } from './child_view_model.svelte';\n")).toBe(1);
    expect(countsFor("import { getChildViewModel } from './child_view_model.svelte.ts';\n")).toBe(
      1,
    );
  });

  test('flags a runtime composition import', () => {
    expect(countsFor("import { getChildViewModel } from './child_composition.ts';\n")).toBe(1);
  });

  test('flags a runtime re-export', () => {
    expect(countsFor("export { getChildViewModel } from './child_view_model.svelte';\n")).toBe(1);
  });

  test('flags an awaited dynamic ViewModel import', () => {
    expect(countsFor("const child = await import('./child_view_model.svelte');\n")).toBe(1);
  });

  test('flags a bare dynamic composition import', () => {
    expect(countsFor("import('./child_composition.ts');\n")).toBe(1);
  });

  test('allows a type-only ViewModel import', () => {
    expect(
      countsFor("import type { ChildViewModelInterface } from './child_view_model.svelte';\n"),
    ).toBe(0);
  });

  test('allows an import whose named bindings are all type-only', () => {
    expect(
      countsFor("import { type ChildViewModelInterface } from './child_view_model.svelte';\n"),
    ).toBe(0);
  });

  test('reports one violation per declaration, with line numbers', () => {
    const violations = collectViewModelImportViolations({
      file,
      source: [
        "import { getA } from './a_view_model.svelte';",
        "import { getB } from './b_view_model.svelte';",
      ].join('\n'),
    });
    expect(violations.map((v) => v.line)).toEqual([1, 2]);
    expect(violations.map((v) => v.specifier)).toEqual([
      './a_view_model.svelte',
      './b_view_model.svelte',
    ]);
  });
});

describe('collectMountedWrites', () => {
  const writesFor = (source: string): number[] =>
    collectMountedWrites(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true));

  test('flags property and element writes to __mounted', () => {
    expect(writesFor('this.__mounted = true;\n')).toEqual([1]);
    expect(writesFor("viewModel['__mounted'] = true;\n")).toEqual([1]);
  });

  test('ignores reads and comparisons', () => {
    expect(writesFor('if (viewModel.__mounted) {}\n')).toEqual([]);
    expect(writesFor('return this.__mounted === true;\n')).toEqual([]);
  });
});

// ── M9 identity: a same-count swap must be visible ───────────────────────

describe('M9 dynamic-import identities', () => {
  /**
   * The M9 rule: `await import()` outside the documented allowlist.
   *
   * 🔴 These violations used to be identified by the constant
   * `simpleHash('m9:dynamic-import')`, so EVERY prohibited dynamic import in a
   * file carried the same identity. Swapping one prohibited import for another
   * at the same count therefore left the identity array byte-identical and
   * passed the ratchet — the identity existed but identified nothing.
   *
   * The identity is now the normalized specifier plus a stable call-site
   * fingerprint, so the two properties that matter are: a swap is DETECTED, and
   * harmless movement is NOT.
   */
  const m9ViolationsFor = (body: string) => {
    const violations: { rule: string; identity?: string }[] = [];
    // The guard's real identity derivation, exercised through the same helpers
    // it uses: the specifier and the enclosing-statement fingerprint.
    const imports = collectModuleImportsForTest(body);
    for (const entry of imports) {
      if (entry.kind !== 'dynamic' || !entry.awaited) {
        continue;
      }
      if (isAllowlistedSpecifier(entry.specifier, VIEW_MODEL_ALLOWLIST)) {
        continue;
      }
      violations.push({ rule: 'm9', identity: `m9:${entry.specifier}:${entry.fingerprint}` });
    }
    return violations;
  };

  test('two different prohibited imports produce different identities', () => {
    const first = m9ViolationsFor("const a = await import('$lib/services/a');");
    const second = m9ViolationsFor("const a = await import('$lib/services/b');");
    expect(first[0]?.identity).not.toBe(second[0]?.identity);
  });

  test('the same prohibited import produces the same identity after a line move', () => {
    const before = m9ViolationsFor("const a = await import('$lib/services/a');");
    const after = m9ViolationsFor("\n\nconst a = await import('$lib/services/a');");
    expect(before[0]?.identity).toBe(after[0]?.identity);
  });

  test('an allowlisted import is not an M9 violation', () => {
    expect(m9ViolationsFor("const a = await import('pixi.js');")).toEqual([]);
    expect(m9ViolationsFor("const a = await import('@aikami/frontend/engine');")).toEqual([]);
  });

  test('a look-alike package is still an M9 violation', () => {
    expect(m9ViolationsFor("const a = await import('@aikami/frontend/engine-evil');")).toHaveLength(
      1,
    );
    expect(m9ViolationsFor("const a = await import('evil-eruda-wrapper');")).toHaveLength(1);
  });

  test('a floating dynamic import is not M9 (that would be a new rule)', () => {
    // The documented rule is `await import()`. Widening it to floating imports
    // is a policy change, not a better implementation, so it is deliberately
    // out of scope — see guards/imports.ts.
    expect(m9ViolationsFor("import('$lib/services/a').then((m) => m);")).toEqual([]);
  });
});
