// packages/frontend/engine/src/rendering/combat_selection_overlay.test.ts
//
// C-525 R-2 — the direct-control highlight overlay is a PURE projection of
// the ViewModel's selection: reachable move endpoints and engine-declared
// legal target cells. These tests pin the merge/dedupe rule (a target wins
// over a reachable cell) and the deterministic ordering so a renderer draws
// exactly what the selection says.

import { describe, expect, test } from 'bun:test';
import {
  buildCombatHighlightCells,
  combatHighlightCellStyle,
  hasCombatHighlights,
} from './combat_selection_overlay.ts';

describe('C-525 R-2 — combat selection highlight projection', () => {
  test('reachable and target cells resolve to distinct styles', () => {
    const reachable = combatHighlightCellStyle('reachable');
    const target = combatHighlightCellStyle('target');
    expect(reachable.fill).not.toBe(target.fill);
    expect(reachable.alpha).toBeGreaterThan(0);
    expect(target.alpha).toBeGreaterThan(0);
  });

  test('builds the union of endpoints and target cells, sorted deterministically', () => {
    const cells = buildCombatHighlightCells({
      legalEndpoints: [
        { x: 2, y: 1 },
        { x: 1, y: 1 },
      ],
      legalTargetCells: [{ x: 1, y: 2 }],
    });

    expect(cells).toEqual([
      { x: 1, y: 1, kind: 'reachable' },
      { x: 2, y: 1, kind: 'reachable' },
      { x: 1, y: 2, kind: 'target' },
    ]);
  });

  test('a target cell overrides a reachable cell at the same coordinate', () => {
    const cells = buildCombatHighlightCells({
      legalEndpoints: [{ x: 3, y: 3 }],
      legalTargetCells: [{ x: 3, y: 3 }],
    });

    expect(cells).toEqual([{ x: 3, y: 3, kind: 'target' }]);
  });

  test('no selection yields no cells', () => {
    const cells = buildCombatHighlightCells({ legalEndpoints: [], legalTargetCells: [] });
    expect(cells).toEqual([]);
    expect(hasCombatHighlights({ legalEndpoints: [], legalTargetCells: [] })).toBe(false);
    expect(hasCombatHighlights({ legalEndpoints: [{ x: 0, y: 0 }], legalTargetCells: [] })).toBe(
      true,
    );
  });
});
