// apps/e2e/src/services/entity_texture_guard.test.ts
//
// C-550: actor placeholders must not pass visual evidence.

import { describe, expect, test } from 'bun:test';
import {
  assertEntityTexturesResolved,
  ENTITY_TEXTURE_GUARD_POLICY,
  type EntityTextureObservation,
  isEntityTextureResolved,
} from '../visual/core/entity_texture_guard.ts';

const observation = (
  overrides: Partial<EntityTextureObservation> = {},
): EntityTextureObservation => ({
  entityId: '2',
  visible: true,
  displayType: 'composed',
  resolvedTextureCount: 6,
  unresolvedTextureCount: 0,
  ...overrides,
});

describe('assertEntityTexturesResolved', () => {
  test('uses the fail-closed v2 policy', () => {
    expect(ENTITY_TEXTURE_GUARD_POLICY).toBe('visible-entity-textures-v2');
  });

  test('accepts composed sprites with real textures', () => {
    expect(() => assertEntityTexturesResolved([observation()])).not.toThrow();
  });

  test('rejects a visible primitive placeholder', () => {
    expect(() =>
      assertEntityTexturesResolved([
        observation({ displayType: 'graphics', resolvedTextureCount: 0 }),
      ]),
    ).toThrow(/entity texture guard failed.*2:graphics/);
  });

  test('rejects an unmatched positioned placeholder instead of exempting it', () => {
    expect(() =>
      assertEntityTexturesResolved([
        observation({
          entityId: 'unidentified:7',
          displayType: 'graphics',
          resolvedTextureCount: 0,
        }),
      ]),
    ).toThrow(/entity texture guard failed.*unidentified:7:graphics/);
  });

  test('rejects a partially resolved composed display', () => {
    expect(() =>
      assertEntityTexturesResolved([observation({ unresolvedTextureCount: 1 })]),
    ).toThrow(/unresolved/);
  });

  test('ignores invisible displays', () => {
    expect(
      isEntityTextureResolved(
        observation({ visible: false, displayType: 'missing', resolvedTextureCount: 0 }),
      ),
    ).toBe(false);
    expect(() =>
      assertEntityTexturesResolved([
        observation({ visible: false, displayType: 'missing', resolvedTextureCount: 0 }),
      ]),
    ).not.toThrow();
  });
});
