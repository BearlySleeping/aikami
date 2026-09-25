// scripts/src/lib/ops/emberwatch_prop_pass.test.ts

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packRoot } from './emberwatch_map_validation_context.ts';
import { readPropFootprintAudit } from './emberwatch_prop_footprint.ts';

type Manifest = {
  props: Record<
    string,
    {
      frame: string;
      isWalkable?: boolean;
      styleClass?: string;
      collision?: { width?: number; height?: number };
    }
  >;
};

const manifest = (): Manifest =>
  JSON.parse(readFileSync(join(packRoot, 'manifest.json'), 'utf8')) as Manifest;

describe('C-561 prop coherence pass', () => {
  test('registers perimeter posts and classifies every prop', () => {
    const props = manifest().props;
    for (const propId of [
      'inn_perimeter_post_w',
      'inn_perimeter_post_e',
      'shop_perimeter_post_w',
      'shop_perimeter_post_e',
      'waystation_perimeter_post_w',
      'waystation_perimeter_post_e',
      'shrine_perimeter_post_w',
      'shrine_perimeter_post_e',
    ]) {
      expect(props[propId], propId).toMatchObject({
        frame: 'prop_support.png',
        styleClass: 'structural',
        isWalkable: false,
      });
    }
    for (const [propId, definition] of Object.entries(props)) {
      expect(definition.styleClass, `${propId} style class`).toBeDefined();
    }
  });

  test('reports visual and collision footprints without inventing full-height blocking', () => {
    const audit = readPropFootprintAudit('inn_perimeter_post_w');
    expect(audit.styleClass).toBe('structural');
    expect(audit.originCovered).toBe(true);
    expect(audit.collisionCellCount).toBe(1);
    expect(audit.visualCellCount).toBeGreaterThan(audit.collisionCellCount);
  });

  test('keeps walkable architectural props free of a false solid footprint', () => {
    const props = manifest().props;
    expect(props.shrine_arch?.isWalkable).toBe(true);
    expect(props.shrine_arch?.collision).toBeUndefined();
  });

  test('adopts exactly two posts per non-village map without duplicate local ids', () => {
    for (const mapId of ['inn', 'merchant_shop', 'old_road', 'ruined_shrine']) {
      const map = JSON.parse(readFileSync(join(packRoot, 'maps', `${mapId}.json`), 'utf8')) as {
        layers: Array<{
          objects?: Array<{ id: number; properties?: Array<{ name: string; value: unknown }> }>;
        }>;
      };
      const objects = map.layers.flatMap((layer) => layer.objects ?? []);
      const postIds = objects
        .map((object) => object.properties?.find((property) => property.name === 'propId')?.value)
        .filter(
          (value): value is string => typeof value === 'string' && value.includes('perimeter_post'),
        );
      expect(postIds, `${mapId} post ids`).toHaveLength(2);
      expect(new Set(objects.map((object) => object.id)).size, `${mapId} object ids`).toBe(
        objects.length,
      );
    }
  });
});
