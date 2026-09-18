// scripts/src/lib/ops/__tests__/guards_imports.test.ts
//
// Tests for the AST-based import collector that the conventions guards use for
// their dependency rules.
//
// The two failure modes these tests exist to prevent are the reason the guards
// stopped using regular expressions for import questions:
//
//   • a specifier mentioned in a comment or a string must NOT be a dependency;
//   • `import '$logger'` (no `from` clause) and a multi-line `import { … }\n
//     from '$services'` MUST be.

import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import {
  collectModuleImports,
  findImport,
  findImports,
  isRuntimeDependency,
} from '../guards/imports.ts';

const specifiers = (source: string): string[] =>
  collectModuleImports({ source }).map((entry) => entry.specifier);

describe('collectModuleImports', () => {
  test('collects static imports, re-exports and literal dynamic imports', () => {
    expect(
      specifiers(`
        import { a } from '$services';
        import '$logger';
        export { b } from '$lib/views/x';
        const lazy = await import('$views/y');
      `),
    ).toEqual(['$services', '$logger', '$lib/views/x', '$views/y']);
  });

  test('collects a multi-line import that a regex on `from "` would miss', () => {
    expect(specifiers("import {\n  a,\n  b,\n} from '$services';\n")).toEqual(['$services']);
  });

  test('never treats a comment or a string as a dependency', () => {
    expect(
      specifiers(`
        // import { a } from '$services';
        /* export { b } from '$lib/views/x'; */
        const doc = "import x from '$logger'";
      `),
    ).toEqual([]);
  });

  test('reports a non-literal dynamic import with an empty specifier', () => {
    const [entry] = collectModuleImports({ source: 'await import(somePath);\n' });
    expect(entry?.specifier).toBe('');
    expect(entry?.kind).toBe('dynamic');
  });

  test('records 1-indexed lines', () => {
    const imports = collectModuleImports({ source: "const x = 1;\nimport '$logger';\n" });
    expect(imports[0]?.line).toBe(2);
  });

  test('marks type-only imports', () => {
    const imports = collectModuleImports({
      source: "import type { A } from '$services';\nimport { type B, c } from '$logger';\n",
    });
    expect(imports[0]?.typeOnly).toBe(true);
    expect(imports[1]?.typeOnly).toBe(false);
  });
});

describe('isRuntimeDependency', () => {
  test('a value import is a runtime dependency', () => {
    expect(isRuntimeDependency(collectDeclaration("import { a } from 'x';"))).toBe(true);
  });

  test('`import type` is not', () => {
    expect(isRuntimeDependency(collectDeclaration("import type { a } from 'x';"))).toBe(false);
  });

  test('all-individually-type named imports are not', () => {
    expect(isRuntimeDependency(collectDeclaration("import { type a, type b } from 'x';"))).toBe(
      false,
    );
  });

  test('a mixed clause is a runtime dependency', () => {
    expect(isRuntimeDependency(collectDeclaration("import { type a, b } from 'x';"))).toBe(true);
  });
});

// Parses a single import/export statement so the predicate can be exercised
// directly, without going through the collector's array.
const collectDeclaration = (source: string): Parameters<typeof isRuntimeDependency>[0] => {
  const sourceFile = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  const statement = sourceFile.statements[0];
  if (!statement) {
    throw new Error('no statement parsed');
  }
  return statement as Parameters<typeof isRuntimeDependency>[0];
};

describe('findImport / findImports', () => {
  const imports = collectModuleImports({
    source: `
      import type { A } from '$services';
      import '$logger';
      import { b } from '$lib/views/x';
      import { c } from '$lib/views/y';
    `,
  });

  test('ignores type-only imports by default', () => {
    const found = findImport(imports, { matches: (specifier) => specifier === '$services' });
    expect(found).toBeUndefined();
  });

  test('finds a runtime import regardless of its clause shape', () => {
    expect(findImport(imports, { matches: (s) => s === '$logger' })?.line).toBe(3);
  });

  test('finds every matching import', () => {
    const found = findImports(imports, { matches: (s) => s.startsWith('$lib/views/') });
    expect(found).toHaveLength(2);
  });

  test('an empty specifier never matches', () => {
    const dynamic = collectModuleImports({ source: 'await import(path);\n' });
    expect(findImports(dynamic, { matches: () => true })).toEqual([]);
  });

  test('staticOnly: false reaches dynamic imports', () => {
    const mixed = collectModuleImports({ source: "import 'a';\nawait import('b');\n" });
    expect(findImports(mixed, { matches: () => true })).toHaveLength(1);
    expect(findImports(mixed, { matches: () => true, staticOnly: false })).toHaveLength(2);
  });
});
