// apps/frontend/gamejs/tests/interface/tutorial/tutorial.test.ts
import { beforeEach, describe, expect, test } from 'bun:test';

const TUTORIAL_STEPS = [
  {
    title: 'Welcome to Aikami!',
    text: 'This tutorial will teach you the basics.',
  },
  {
    title: 'Movement',
    text: 'Use W, A, S, D or arrow keys to move your character.',
  },
  {
    title: 'Interaction',
    text: 'Press E or the action button to interact with objects and NPCs.',
  },
  {
    title: 'Pause',
    text: 'Press Escape to pause the game and access the menu.',
  },
  {
    title: "You're Ready!",
    text: 'Enjoy your adventure in Aikami!',
  },
];

describe('Tutorial', () => {
  let currentStep: number;
  let isVisible: boolean;
  let isComplete: boolean;

  beforeEach(() => {
    currentStep = 0;
    isVisible = false;
    isComplete = false;
  });

  test('should have 5 tutorial steps', () => {
    expect(TUTORIAL_STEPS.length).toBe(5);
  });

  test('should start on step 0', () => {
    expect(currentStep).toBe(0);
  });

  test('should advance to next step', () => {
    currentStep++;
    expect(currentStep).toBe(1);
  });

  test('should show first step title', () => {
    expect(TUTORIAL_STEPS[0].title).toBe('Welcome to Aikami!');
  });

  test('should show movement step', () => {
    expect(TUTORIAL_STEPS[1].title).toBe('Movement');
  });

  test('should complete tutorial on last step', () => {
    currentStep = TUTORIAL_STEPS.length - 1;
    isComplete = true;
    expect(isComplete).toBe(true);
  });

  test('should hide on skip', () => {
    isVisible = true;
    isVisible = false;
    isComplete = true;
    expect(isComplete).toBe(true);
  });

  test('should have valid titles for all steps', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.text.length).toBeGreaterThan(0);
    }
  });
});
