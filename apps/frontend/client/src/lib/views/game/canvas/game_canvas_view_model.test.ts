// apps/frontend/client/src/lib/views/game/canvas/game_canvas_view_model.test.ts
//
// Game Canvas ViewModel tests. The ViewModel is constructed from capability
// fixtures, so the suite never touches the production service registry.
//
// Contract: C-326 — Cancellable staged boot orchestrator
// Contract: C-381 AC-10 — the canvas ViewModel reads the campaign's pack id
//   instead of hardcoding 'emberwatch'.

import { describe, expect, mock, test } from 'bun:test';
import type { GameCommand } from '@aikami/frontend/engine/sim';
import { BaseViewModel } from '@aikami/frontend/services/base';
import {
  createGameCanvasViewModel,
  type GameCanvasBootCapabilities,
  type GameCanvasCampaignCapabilities,
  type GameCanvasEngineCapabilities,
  type GameCanvasModeCapabilities,
} from './game_canvas_view_model.svelte';

const createCampaignFixture = (
  overrides: Partial<GameCanvasCampaignCapabilities> = {},
): GameCanvasCampaignCapabilities => ({
  activeCampaign: undefined,
  ...overrides,
});

const createBootFixture = (
  overrides: Partial<GameCanvasBootCapabilities> = {},
): GameCanvasBootCapabilities => ({
  bootProgress: { stage: 'idle', stageIndex: 0, stageCount: 12 },
  isBooting: false,
  boot: mock(async () => ({ outcome: 'cancelled' as const })),
  teardown: mock(() => {}),
  ...overrides,
});

const createEngineFixture = (
  overrides: Partial<GameCanvasEngineCapabilities> = {},
): GameCanvasEngineCapabilities => ({
  playerScene: 'emberwatch_village',
  isGameReady: false,
  gameError: undefined,
  activeContexts: [],
  playerDisplayName: 'Hero',
  floatingTexts: [],
  combatantScreenStates: [],
  isShaking: false,
  initializeEngine: mock(async () => {}),
  destroyEngine: mock(() => {}),
  removeFloatingText: mock(() => {}),
  sendCommand: mock((_command: GameCommand) => {}),
  pauseEngine: mock(() => {}),
  resumeEngine: mock(() => {}),
  triggerResize: mock(() => {}),
  loadMap: mock(async () => {}),
  loadSave: mock(async () => {}),
  ...overrides,
});

const createModeFixture = (
  overrides: Partial<GameCanvasModeCapabilities> = {},
): GameCanvasModeCapabilities => ({
  currentMode: 'EXPLORE',
  ...overrides,
});

const createViewModel = (
  options: {
    campaign?: GameCanvasCampaignCapabilities;
    boot?: GameCanvasBootCapabilities;
    engine?: GameCanvasEngineCapabilities;
    mode?: GameCanvasModeCapabilities;
  } = {},
) =>
  createGameCanvasViewModel({
    className: 'GameCanvasViewModel',
    campaign: options.campaign ?? createCampaignFixture(),
    boot: options.boot ?? createBootFixture(),
    engine: options.engine ?? createEngineFixture(),
    mode: options.mode ?? createModeFixture(),
  });

describe('GameCanvasViewModel — proxied engine state', () => {
  test('reads engine fields from the capability', () => {
    const viewModel = createViewModel({
      engine: createEngineFixture({ isGameReady: true, playerScene: 'forest' }),
    });

    expect(viewModel.playerScene).toBe('forest');
    expect(viewModel.isGameReady).toBe(true);
    expect(viewModel.playerDisplayName).toBe('Hero');
  });

  test('prefers the boot error over the engine error', () => {
    const viewModel = createViewModel({
      boot: createBootFixture({
        bootProgress: { stage: 'failed', stageIndex: 4, stageCount: 12, error: 'boot failed' },
      }),
      engine: createEngineFixture({ gameError: 'engine failed' }),
    });

    expect(viewModel.gameError).toBe('boot failed');
  });

  test('isCombat reflects the game mode', () => {
    expect(createViewModel().isCombat).toBe(false);
    expect(createViewModel({ mode: createModeFixture({ currentMode: 'COMBAT' }) }).isCombat).toBe(
      true,
    );
  });
});

describe('GameCanvasViewModel — delegated commands', () => {
  test('forwards engine commands to the capability', () => {
    const sendCommand = mock((_command: GameCommand) => {});
    const viewModel = createViewModel({ engine: createEngineFixture({ sendCommand }) });

    viewModel.sendCommand({ type: 'STOP_PLAYER' });

    expect(sendCommand).toHaveBeenCalledTimes(1);
  });

  test('initializeEngine runs during initialize', async () => {
    const initializeEngine = mock(async () => {});
    const viewModel = createViewModel({ engine: createEngineFixture({ initializeEngine }) });

    await viewModel.initialize();

    expect(initializeEngine).toHaveBeenCalledTimes(1);
  });
});

describe('GameCanvasViewModel — boot pipeline', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });

  test('boots with the active campaign content pack', async () => {
    const boot = mock(async () => ({ outcome: 'cancelled' as const }));
    const canvas = {} as HTMLCanvasElement;
    const viewModel = createViewModel({
      campaign: createCampaignFixture({
        activeCampaign: {
          contentPackId: 'ashes-of-eldoria',
        } as GameCanvasCampaignCapabilities['activeCampaign'],
      }),
      boot: createBootFixture({ boot }),
    });

    viewModel.canvasElement = canvas;
    await viewModel.initialize();

    expect(boot).toHaveBeenCalledTimes(1);
    expect(boot.mock.calls[0]?.[0]).toMatchObject({ contentPackId: 'ashes-of-eldoria' });
  });
});
