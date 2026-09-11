// apps/frontend/client/src/lib/views/combat/testing/combat_fixtures.ts
//
// Feature-owned test doubles for the combat ViewModel. Every factory returns a
// fresh object typed against the narrow capability contracts the ViewModel
// consumes, so tests assert against explicit behavior instead of the implicit,
// invent-anything proxy in the global `$services` mock.
//
// These doubles carry no dependencies on the test runner; callers pass spies
// (e.g. `mock(...)`) through the overrides argument when they need to assert
// calls.

import type { AudioTrackEntry } from '@aikami/schemas';
import type { CombatLogEntry } from '../combat_log_service.svelte';
import type {
  CombatAudioCapabilities,
  CombatDiceCapabilities,
  CombatEngineCapabilities,
  CombatExpressionCapabilities,
  CombatImageCapabilities,
  CombatInventoryCapabilities,
  CombatLogCapabilities,
  CombatPlayerStateCapabilities,
  CombatStatusEffectsCapabilities,
  CombatTextCapabilities,
  CombatTtsCapabilities,
  CombatViewModelOptions,
  CombatWorldGenCapabilities,
  CombatWorldStateCapabilities,
} from '../combat_view_model.svelte';
import type { DeathSaveState, StatusEffectDisplay } from '../types/combat_enhancements.ts';

/** Engine double — the bridge is never created because tests do not initialize. */
export const createCombatEngine = (
  overrides: Partial<CombatEngineCapabilities> = {},
): CombatEngineCapabilities => ({
  createBridge: async () => {
    throw new Error('Combat engine bridge is not available in unit tests.');
  },
  ...overrides,
});

/** Image-generation double. */
export const createCombatImages = (
  overrides: Partial<CombatImageCapabilities> = {},
): CombatImageCapabilities => ({
  isGenerating: false,
  generationStatus: '',
  generationProgress: 0,
  generateImage: async () => ({ url: '', isDemo: true }),
  ...overrides,
});

/** Text-generation double. */
export const createCombatText = (
  overrides: Partial<CombatTextCapabilities> = {},
): CombatTextCapabilities => ({
  extractStructure: async () => ({}),
  ...overrides,
});

/** TTS double. */
export const createCombatTts = (
  overrides: Partial<CombatTtsCapabilities> = {},
): CombatTtsCapabilities => ({
  synthesize: async () => {},
  ...overrides,
});

/** Dice double. */
export const createCombatDice = (
  overrides: Partial<CombatDiceCapabilities> = {},
): CombatDiceCapabilities => ({
  rollNotation: () => 0,
  ...overrides,
});

/** Audio catalog + playback double. */
export const createCombatAudio = (
  overrides: Partial<CombatAudioCapabilities> = {},
): CombatAudioCapabilities => ({
  getTracksByMood: async (): Promise<readonly AudioTrackEntry[]> => [],
  resolveAudioTrackUrl: async (entry: AudioTrackEntry): Promise<string> => entry.assetPath,
  transitionToBgm: async () => {},
  playSceneBgm: async () => {},
  ...overrides,
});

/** Expression overlay resolver double. */
export const createCombatExpressions = (
  overrides: Partial<CombatExpressionCapabilities> = {},
): CombatExpressionCapabilities => ({
  resolveLpcOverlays: () => ({}),
  ...overrides,
});

/** Player-state double. */
export const createCombatPlayerState = (
  overrides: Partial<CombatPlayerStateCapabilities> = {},
): CombatPlayerStateCapabilities => ({
  classId: 'fighter',
  ...overrides,
});

/** Inventory double. */
export const createCombatInventory = (
  overrides: Partial<CombatInventoryCapabilities> = {},
): CombatInventoryCapabilities => ({
  inventory: [],
  ...overrides,
});

/** World-state double. */
export const createCombatWorldState = (
  overrides: Partial<CombatWorldStateCapabilities> = {},
): CombatWorldStateCapabilities => ({
  worldGenOutput: undefined,
  ...overrides,
});

/** World-context GM prompt double. */
export const createCombatWorldGen = (
  overrides: Partial<CombatWorldGenCapabilities> = {},
): CombatWorldGenCapabilities => ({
  assembleGmPrompt: () => '',
  ...overrides,
});

/** Combat-log domain double. */
export const createCombatLog = (
  overrides: Partial<CombatLogCapabilities> = {},
): CombatLogCapabilities => ({
  parseActor: (message: string, enemyName: string): string => {
    if (message.startsWith('Player ')) {
      return 'Player';
    }
    if (message.startsWith('Enemy ')) {
      return enemyName || 'Enemy';
    }
    return 'System';
  },
  updateEntryImage: (
    entries: readonly CombatLogEntry[],
    entryId: string,
    imageUrl: string | undefined,
  ): CombatLogEntry[] => {
    const idx = entries.findIndex((e) => e.id === entryId);
    if (idx === -1) {
      return [...entries];
    }
    const copy = [...entries];
    const old = copy[idx];
    if (!old) {
      return copy;
    }
    copy[idx] = {
      ...old,
      imageUrl: imageUrl ?? old.imageUrl,
      isGeneratingImage: false,
    };
    return copy;
  },
  ...overrides,
});

/** Status-effect + death-save double. */
export const createCombatStatusEffects = (
  overrides: Partial<CombatStatusEffectsCapabilities> = {},
): CombatStatusEffectsCapabilities => {
  let playerStatusEffects: StatusEffectDisplay[] = [];
  let enemyStatusEffects: Record<number, StatusEffectDisplay[]> = {};
  let deathSaveState: DeathSaveState | null = null;
  let isAnyEntityDowned = false;
  return {
    get playerStatusEffects() {
      return playerStatusEffects;
    },
    get enemyStatusEffects() {
      return enemyStatusEffects;
    },
    get deathSaveState() {
      return deathSaveState;
    },
    get isAnyEntityDowned() {
      return isAnyEntityDowned;
    },
    reset: () => {
      playerStatusEffects = [];
      enemyStatusEffects = {};
      deathSaveState = null;
      isAnyEntityDowned = false;
    },
    applyStatus: () => {},
    expireStatus: () => {},
    setEntityDowned: () => {
      isAnyEntityDowned = true;
    },
    setDeathSave: (successes, failures) => {
      deathSaveState = { successes, failures };
    },
    revive: () => {},
    ...overrides,
  };
};

/** Builds a fully-wired option set with every capability defaulted. */
export const createCombatTestOptions = (
  overrides: Partial<CombatViewModelOptions> = {},
): CombatViewModelOptions => ({
  className: 'CombatViewModelTest',
  engine: createCombatEngine(),
  images: createCombatImages(),
  text: createCombatText(),
  tts: createCombatTts(),
  dice: createCombatDice(),
  audio: createCombatAudio(),
  expressions: createCombatExpressions(),
  playerState: createCombatPlayerState(),
  inventory: createCombatInventory(),
  worldState: createCombatWorldState(),
  worldGen: createCombatWorldGen(),
  combatLog: createCombatLog(),
  statusEffects: createCombatStatusEffects(),
  ...overrides,
});
