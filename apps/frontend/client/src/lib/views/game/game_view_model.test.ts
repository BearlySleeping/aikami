// apps/frontend/client/src/lib/views/game/game_view_model.test.ts
//
// Game composition-root ViewModel tests. The composition root and child
// ViewModel factories arrive as construction capabilities, so this suite
// injects stubs and never imports `$services`.

import { describe, expect, mock, test } from 'bun:test';
import type { CombatViewModelInterface } from '$views/combat/combat_view_model.svelte';
import type { GameCanvasViewModelInterface } from './canvas/game_canvas_view_model.svelte';
import { createGameViewModel, type GameViewModelOptions } from './game_view_model.svelte';
import type { GameUIViewModelInterface } from './ui/game_ui_view_model.svelte';

const createCanvasStub = (overrides: Partial<GameCanvasViewModelInterface> = {}) =>
  ({
    isCombat: false,
    initialize: mock(async () => {}),
    dispose: mock(async () => {}),
    ...overrides,
  }) as GameCanvasViewModelInterface;

const createUiStub = (overrides: Partial<GameUIViewModelInterface> = {}) =>
  ({
    combatViewModel: undefined,
    initialize: mock(async () => {}),
    dispose: mock(async () => {}),
    handleKeyDown: mock(() => {}),
    ...overrides,
  }) as GameUIViewModelInterface;

const buildViewModelOptions = (options: {
  composition: GameViewModelOptions['composition'];
  canvas: GameCanvasViewModelInterface;
  ui: GameUIViewModelInterface;
}): GameViewModelOptions => ({
  className: 'GameViewModel',
  composition: options.composition,
  createCanvasViewModel: () => options.canvas,
  createUIViewModel: () => options.ui,
});

describe('GameViewModel — child composition', () => {
  const composition = { initialize: mock(async () => {}), dispose: mock(async () => {}) };

  test('creates the canvas and UI child ViewModels eagerly', () => {
    const canvas = createCanvasStub();
    const ui = createUiStub();
    const vm = createGameViewModel(buildViewModelOptions({ composition, canvas, ui }));

    expect(vm.canvasViewModel).toBe(canvas);
    expect(vm.uiViewModel).toBe(ui);
  });

  test('delegates isCombat to the canvas ViewModel', () => {
    const canvas = createCanvasStub({ isCombat: true });
    const ui = createUiStub();
    const vm = createGameViewModel(buildViewModelOptions({ composition, canvas, ui }));

    expect(vm.isCombat).toBe(true);
  });

  test('exposes the active combat ViewModel while the canvas is in combat mode', () => {
    const combatViewModel = {} as CombatViewModelInterface;
    const ui = createUiStub({ combatViewModel });
    const vm = createGameViewModel(
      buildViewModelOptions({ composition, canvas: createCanvasStub({ isCombat: true }), ui }),
    );

    expect(vm.activeCombatViewModel).toBe(combatViewModel);
  });

  test('hides the combat ViewModel outside combat mode', () => {
    const combatViewModel = {} as CombatViewModelInterface;
    const ui = createUiStub({ combatViewModel });
    const vm = createGameViewModel(
      buildViewModelOptions({ composition, canvas: createCanvasStub(), ui }),
    );

    expect(vm.activeCombatViewModel).toBeUndefined();
  });

  test('delegates key handling to the UI ViewModel', () => {
    const ui = createUiStub();
    const vm = createGameViewModel(
      buildViewModelOptions({ composition, canvas: createCanvasStub(), ui }),
    );
    const event = {} as KeyboardEvent;

    vm.handleKeyDown(event);

    expect(ui.handleKeyDown).toHaveBeenCalledWith(event);
  });
});

describe('GameViewModel — lifecycle', () => {
  test('initializes the composition root before the children', async () => {
    const order: string[] = [];
    const composition = {
      initialize: mock(async () => {
        order.push('composition');
      }),
      dispose: mock(async () => {}),
    };
    const canvas = createCanvasStub({
      initialize: mock(async () => {
        order.push('canvas');
      }),
    });
    const ui = createUiStub({
      initialize: mock(async () => {
        order.push('ui');
      }),
    });
    const vm = createGameViewModel(buildViewModelOptions({ composition, canvas, ui }));

    await vm.initialize();

    expect(order).toEqual(['composition', 'canvas', 'ui']);
  });

  test('dispose disposes children then the composition root', async () => {
    const order: string[] = [];
    const composition = {
      initialize: mock(async () => {}),
      dispose: mock(async () => {
        order.push('composition');
      }),
    };
    const canvas = createCanvasStub({
      dispose: mock(async () => {
        order.push('canvas');
      }),
    });
    const ui = createUiStub({
      dispose: mock(async () => {
        order.push('ui');
      }),
    });
    const vm = createGameViewModel(buildViewModelOptions({ composition, canvas, ui }));

    await vm.dispose();

    expect(order).toEqual(['canvas', 'ui', 'composition']);
  });
});
