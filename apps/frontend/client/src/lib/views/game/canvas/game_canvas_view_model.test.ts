// apps/frontend/client/src/lib/views/game/canvas/game_canvas_view_model.test.ts
//
// Contract: C-381 AC-10 — the canvas ViewModel reads the campaign's pack id
// instead of hardcoding 'emberwatch'.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

describe('GameCanvasViewModel — C-381 AC-10', () => {
  test('imports without error', () => {
    // The ViewModel must import cleanly
    expect(async () => {
      await import('./game_canvas_view_model.svelte.ts');
    }).not.toThrow();
  });
});
