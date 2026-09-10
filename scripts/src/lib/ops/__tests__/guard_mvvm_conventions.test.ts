// scripts/src/lib/ops/__tests__/guard_mvvm_conventions.test.ts
//
// Regression tests for M8's AST dependency detection. The previous
// implementation stripped strings before searching for quoted import paths,
// so it reported zero violations for every real edge and shipped green while
// 49 ViewModel-to-ViewModel/composition imports existed in the client.

import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import {
  collectMountedWrites,
  collectViewModelImportViolations,
  isViewModelDependencySpecifier,
} from '../view_model_dependency_rules.ts';

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
