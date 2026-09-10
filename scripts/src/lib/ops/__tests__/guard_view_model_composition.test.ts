// scripts/src/lib/ops/__tests__/guard_view_model_composition.test.ts
//
// Tests for the ViewModel composition-boundary guard: runtime `$services` /
// aggregate `@aikami/frontend/services` imports are flagged, while erased
// type-only imports are allowed.

import { describe, expect, test } from 'bun:test';
import {
  collectCompositionViolations,
  isAggregateServicesSpecifier,
  isServicesBarrelSpecifier,
} from '../guard_view_model_composition.ts';

const file = 'apps/frontend/client/src/lib/views/example/example_view_model.svelte.ts';

const rulesFor = (source: string): string[] =>
  collectCompositionViolations({ file, source }).map((violation) => violation.rule);

describe('isServicesBarrelSpecifier', () => {
  test('matches the barrel and its subpaths', () => {
    expect(isServicesBarrelSpecifier('$services')).toBe(true);
    expect(isServicesBarrelSpecifier('$services/game/session_service.svelte')).toBe(true);
    expect(isServicesBarrelSpecifier('$service')).toBe(false);
    expect(isServicesBarrelSpecifier('@aikami/frontend/services')).toBe(false);
  });
});

describe('isAggregateServicesSpecifier', () => {
  test('matches only the exact package root', () => {
    expect(isAggregateServicesSpecifier('@aikami/frontend/services')).toBe(true);
    expect(isAggregateServicesSpecifier('@aikami/frontend/services/base')).toBe(false);
  });
});

describe('collectCompositionViolations — $services', () => {
  test('flags a runtime barrel import', () => {
    expect(rulesFor("import { questStateService } from '$services';\n")).toEqual(['c1']);
  });

  test('flags a runtime subpath import', () => {
    expect(
      rulesFor("import { sessionService } from '$services/game/session_service.svelte';\n"),
    ).toEqual(['c1']);
  });

  test('allows a fully type-only import', () => {
    expect(rulesFor("import type { Foo } from '$services';\n")).toEqual([]);
  });

  test('allows an import whose named bindings are all type-only', () => {
    expect(rulesFor("import { type Foo } from '$services';\n")).toEqual([]);
  });

  test('flags a mixed import that includes a value binding', () => {
    expect(rulesFor("import { type Foo, bar } from '$services';\n")).toEqual(['c1']);
  });

  test('flags a runtime re-export', () => {
    expect(rulesFor("export { questStateService } from '$services';\n")).toEqual(['c1']);
  });

  test('allows a type-only re-export', () => {
    expect(rulesFor("export type { Foo } from '$services';\n")).toEqual([]);
  });
});

describe('collectCompositionViolations — aggregate services root', () => {
  test('flags a runtime root import', () => {
    expect(rulesFor("import { BaseViewModel } from '@aikami/frontend/services';\n")).toEqual([
      'c2',
    ]);
  });

  test('flags a mixed root import with a value binding', () => {
    expect(
      rulesFor(
        "import { BaseViewModel, type BaseViewModelInterface } from '@aikami/frontend/services';\n",
      ),
    ).toEqual(['c2']);
  });

  test('allows a type-only root import', () => {
    expect(rulesFor("import type { DialogState } from '@aikami/frontend/services';\n")).toEqual([]);
  });

  test('allows the narrow base entrypoint', () => {
    expect(rulesFor("import { BaseViewModel } from '@aikami/frontend/services/base';\n")).toEqual(
      [],
    );
  });

  test('ignores relative and unrelated imports', () => {
    expect(rulesFor("import { helper } from './helper.ts';\n")).toEqual([]);
    expect(rulesFor("import type { Foo } from '@aikami/types';\n")).toEqual([]);
  });
});
