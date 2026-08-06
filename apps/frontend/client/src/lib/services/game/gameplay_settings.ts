// apps/frontend/client/src/lib/services/game/gameplay_settings.ts
//
// Shared gameplay-settings reader — reads the difficulty level persisted by
// the GameplayViewModel under the `aikami_gameplay_settings` storage key.
// Used by the GM/NPC dialogue context projection to tune how explicitly NPCs
// guide the player toward quest objectives (easy = direct, hard = realistic).

export type GameplayDifficulty = 'easy' | 'medium' | 'hard';

const STORAGE_KEY = 'aikami_gameplay_settings';

const VALID_DIFFICULTIES: readonly GameplayDifficulty[] = ['easy', 'medium', 'hard'];

export const DEFAULT_DIFFICULTY: GameplayDifficulty = 'medium';

/**
 * Reads the persisted difficulty level. Falls back to {@link DEFAULT_DIFFICULTY}
 * when storage is unavailable or the value is invalid.
 */
export const getGameplayDifficulty = (): GameplayDifficulty => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { difficulty?: unknown };
      if (
        typeof parsed.difficulty === 'string' &&
        (VALID_DIFFICULTIES as readonly string[]).includes(parsed.difficulty)
      ) {
        return parsed.difficulty as GameplayDifficulty;
      }
    }
  } catch {
    // localStorage unavailable (SSR/privacy mode) or invalid JSON — default
  }
  return DEFAULT_DIFFICULTY;
};
