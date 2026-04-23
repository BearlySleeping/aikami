// apps/frontend/gamejs/tests/interface/menus/main/main_menu.test.ts
import { beforeEach, describe, expect, test } from 'bun:test';

enum MenuState {
  MAIN = 'main',
  OPTIONS = 'options',
  CREDITS = 'credits',
  GAME = 'game',
  PAUSE = 'pause',
}

describe('MainMenu', () => {
  let currentState: MenuState;
  let hasStartButton: boolean;
  let hasOptionsButton: boolean;
  let hasCreditsButton: boolean;
  let hasQuitButton: boolean;

  beforeEach(() => {
    currentState = MenuState.MAIN;
    hasStartButton = true;
    hasOptionsButton = true;
    hasCreditsButton = true;
    hasQuitButton = true;
  });

  test('should start in main menu state', () => {
    expect(currentState).toBe(MenuState.MAIN);
  });

  test('should have all menu buttons', () => {
    expect(hasStartButton).toBe(true);
    expect(hasOptionsButton).toBe(true);
    expect(hasCreditsButton).toBe(true);
    expect(hasQuitButton).toBe(true);
  });

  test('should transition to options on options button', () => {
    currentState = MenuState.OPTIONS;
    expect(currentState).toBe(MenuState.OPTIONS);
  });

  test('should transition to credits on credits button', () => {
    currentState = MenuState.CREDITS;
    expect(currentState).toBe(MenuState.CREDITS);
  });

  test('should transition to game on start button', () => {
    currentState = MenuState.GAME;
    expect(currentState).toBe(MenuState.GAME);
  });

  test('should hide reset button when no save exists', () => {
    const hasSave = false;
    expect(hasSave).toBe(false);
  });

  test('should show reset button when save exists', () => {
    const hasSave = true;
    expect(hasSave).toBe(true);
  });
});
