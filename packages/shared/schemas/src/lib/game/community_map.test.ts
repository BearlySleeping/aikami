// packages/shared/schemas/src/lib/game/community_map.test.ts
//
// Contract: C-508 (Map Studio Phase 3) — the community-map document gate.
// Covers the canonical schema check plus the cross-field invariants:
// grid lengths, unique ids and bounded navigation indices.

import { describe, expect, test } from 'bun:test';
import { SCENE_DOCUMENT_KIND, SCENE_SCHEMA_VERSION } from '@aikami/constants';
import { validateCommunityMapDocument } from './community_map.ts';
import type { SceneDocument } from './scene.ts';

const makeScene = (overrides?: Partial<SceneDocument>): SceneDocument => ({
  kind: SCENE_DOCUMENT_KIND,
  schemaVersion: SCENE_SCHEMA_VERSION,
  id: 'test-scene',
  assetLock: 'pack:test',
  extent: { width: 2, height: 2, tileSize: 32 },
  surface: { mode: 'baked', palette: ['', 'grass.png'], grid: [0, 1, 1, 0] },
  layers: [],
  placements: [],
  navigation: {},
  ...overrides,
});

describe('validateCommunityMapDocument', () => {
  test('accepts a schema-valid native scene and returns its id', () => {
    const result = validateCommunityMapDocument(makeScene());
    expect(result.valid).toBe(true);
    expect(result.mapId).toBe('test-scene');
    expect(result.issues).toHaveLength(0);
  });

  test('parses a JSON string document', () => {
    const result = validateCommunityMapDocument(JSON.stringify(makeScene()));
    expect(result.valid).toBe(true);
  });

  test('rejects malformed JSON with a stable code', () => {
    const result = validateCommunityMapDocument('{ not json');
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe('document.invalid-json');
  });

  test('rejects a non-object document', () => {
    const result = validateCommunityMapDocument([1, 2, 3]);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe('document.not-object');
  });

  test('rejects an unsupported document kind', () => {
    const result = validateCommunityMapDocument({ ...makeScene(), kind: 'aikami.region' });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe('document.unsupported-kind');
  });

  test('reports schema violations', () => {
    const result = validateCommunityMapDocument({
      ...makeScene(),
      extent: { width: 0, height: 2, tileSize: 32 },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'document.schema-invalid')).toBe(true);
  });

  test('rejects a grid whose length does not match the extent', () => {
    const scene = makeScene();
    const result = validateCommunityMapDocument({
      ...scene,
      surface: { mode: 'baked', palette: ['', 'grass.png'], grid: [0, 1, 1] },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'document.cell-count-mismatch')).toBe(true);
  });

  test('rejects duplicate placement ids', () => {
    const placement = { id: 'prop-1', component: 'prop', frame: 'grass.png', x: 0, y: 0 };
    const result = validateCommunityMapDocument(
      makeScene({ placements: [placement, { ...placement, x: 32 }] }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'document.duplicate-placement-id')).toBe(
      true,
    );
  });

  test('rejects navigation overrides outside the extent', () => {
    const result = validateCommunityMapDocument(
      makeScene({ navigation: { blockingOverrides: [{ index: 99, blocked: true }] } }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === 'document.navigation-index-out-of-range'),
    ).toBe(true);
  });

  test('accepts a terrain surface with a matching cell count', () => {
    const result = validateCommunityMapDocument(
      makeScene({
        surface: {
          mode: 'terrain',
          defaultTerrain: 'grass',
          cells: ['grass', 'dirt', 'grass', ''],
        },
      }),
    );
    expect(result.valid).toBe(true);
  });
});
