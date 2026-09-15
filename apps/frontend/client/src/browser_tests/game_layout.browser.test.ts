// apps/frontend/client/src/browser_tests/game_layout.browser.test.ts
// Real-runes coverage for rem-sensitive combat layout metrics.

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CombatViewModelInterface } from '../lib/views/combat/combat_view_model.svelte';
import type { GameCanvasViewModelInterface } from '../lib/views/game/canvas/game_canvas_view_model.svelte';
import { createGameViewModel } from '../lib/views/game/game_view_model.svelte';
import { resolveCombatLayout } from '../lib/views/game/ui/combat_layout.ts';
import type { GameUIViewModelInterface } from '../lib/views/game/ui/game_ui_view_model.svelte';

const disposables: Array<() => Promise<void>> = [];

const createCanvasStub = (overrides: Partial<GameCanvasViewModelInterface> = {}) =>
  ({
    _className: 'GameCanvasViewModel',
    __mounted: false,
    errorMessage: undefined,
    showLoadingView: false,
    isCombat: false,
    initialize: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    ...overrides,
  }) as GameCanvasViewModelInterface;

const createUiStub = (overrides: Partial<GameUIViewModelInterface> = {}) =>
  ({
    _className: 'GameUIViewModel',
    __mounted: false,
    errorMessage: undefined,
    showLoadingView: false,
    combatViewModel: undefined,
    initialize: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    handleKeyDown: vi.fn(() => {}),
    ...overrides,
  }) as GameUIViewModelInterface;

afterEach(async () => {
  document.documentElement.style.removeProperty('font-size');
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe('GameViewModel — responsive combat layout (real runes)', () => {
  test('recomputes layout and sheet height when root text scale changes', async () => {
    document.documentElement.style.fontSize = '16px';
    const combatViewModel = {} as CombatViewModelInterface;
    const canvasViewModel = createCanvasStub({ isCombat: true });
    const uiViewModel = createUiStub({ combatViewModel });
    const viewModel = createGameViewModel({
      className: 'GameViewModel',
      composition: {
        initialize: vi.fn(async () => {}),
        dispose: vi.fn(async () => {}),
      },
      createCanvasViewModel: () => canvasViewModel,
      createUIViewModel: () => uiViewModel,
    });
    disposables.push(() => viewModel.dispose());
    await viewModel.initialize();

    await vi.waitFor(() => expect(viewModel.rootFontSize).toBe(16));
    const initialSheetHeight = viewModel.combatSheetHeight;

    document.documentElement.style.fontSize = '32px';

    await vi.waitFor(() => expect(viewModel.rootFontSize).toBe(32));
    expect(viewModel.combatLayout).toBe(
      resolveCombatLayout({
        width: window.innerWidth,
        height: window.innerHeight,
        rootFontSize: 32,
      }),
    );
    expect(viewModel.combatSheetHeight).not.toBe(initialSheetHeight);
  });
});
