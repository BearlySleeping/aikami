import { describe, expect, test } from 'bun:test';

interface GameStateData {
  score: number;
  isPaused: boolean;
  currentLevel: number;
}

function createInitialState(): GameStateData {
  return {
    score: 0,
    isPaused: false,
    currentLevel: 1,
  };
}

function addScore(state: GameStateData, points: number): GameStateData {
  if (state.isPaused) return state;
  return { ...state, score: state.score + points };
}

function changeLevel(state: GameStateData, newLevel: number): GameStateData {
  return { ...state, currentLevel: newLevel };
}

function togglePause(state: GameStateData): GameStateData {
  return { ...state, isPaused: !state.isPaused };
}

function resetGame(_state: GameStateData): GameStateData {
  return createInitialState();
}

describe('Game Logic', () => {
  describe('createInitialState', () => {
    test('creates state with default values', () => {
      const state = createInitialState();
      expect(state.score).toBe(0);
      expect(state.isPaused).toBe(false);
      expect(state.currentLevel).toBe(1);
    });
  });

  describe('addScore', () => {
    test('adds points to score when not paused', () => {
      const state = createInitialState();
      const result = addScore(state, 100);
      expect(result.score).toBe(100);
    });

    test('does not add points when paused', () => {
      const state = { ...createInitialState(), isPaused: true };
      const result = addScore(state, 100);
      expect(result.score).toBe(0);
    });

    test('accumulates score over multiple calls', () => {
      let state = createInitialState();
      state = addScore(state, 50);
      state = addScore(state, 25);
      expect(state.score).toBe(75);
    });
  });

  describe('changeLevel', () => {
    test('changes to new level', () => {
      const state = createInitialState();
      const result = changeLevel(state, 3);
      expect(result.currentLevel).toBe(3);
    });

    test('preserves score when changing level', () => {
      const state = { ...createInitialState(), score: 500 };
      const result = changeLevel(state, 5);
      expect(result.currentLevel).toBe(5);
      expect(result.score).toBe(500);
    });
  });

  describe('togglePause', () => {
    test('pauses unpaused game', () => {
      const state = createInitialState();
      const result = togglePause(state);
      expect(result.isPaused).toBe(true);
    });

    test('unpauses paused game', () => {
      const state = { ...createInitialState(), isPaused: true };
      const result = togglePause(state);
      expect(result.isPaused).toBe(false);
    });
  });

  describe('resetGame', () => {
    test('resets all values to default', () => {
      const state: GameStateData = { score: 1000, isPaused: true, currentLevel: 10 };
      const result = resetGame(state);
      expect(result.score).toBe(0);
      expect(result.isPaused).toBe(false);
      expect(result.currentLevel).toBe(1);
    });
  });
});

describe('Score Calculations', () => {
  test('calculates bonus score', () => {
    const baseScore = 100;
    const multiplier = 2;
    const bonus = 50;
    const calculated = baseScore * multiplier + bonus;
    expect(calculated).toBe(250);
  });

  test('calculates combo score', () => {
    const hits = 5;
    const basePoints = 10;
    const comboMultiplier = 1.5;
    const result = Math.floor(hits * basePoints * comboMultiplier);
    expect(result).toBe(75);
  });
});
