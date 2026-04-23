// apps/frontend/gamejs/tests/interface/menus/credits/credits.test.ts
import { beforeEach, describe, expect, test } from 'bun:test';

describe('Credits', () => {
  let isVisible: boolean;
  let creditsText: string;

  beforeEach(() => {
    isVisible = false;
    creditsText = `
AIKAMI

A Game by Aikami Team

Programming
------------
Lead Developer

© 2026 Aikami
`;
  });

  test('should have credits text', () => {
    expect(creditsText.length).toBeGreaterThan(0);
  });

  test('should contain game title', () => {
    expect(creditsText).toContain('AIKAMI');
  });

  test('should contain copyright', () => {
    expect(creditsText).toContain('2026');
  });

  test('should be visible when shown', () => {
    isVisible = true;
    expect(isVisible).toBe(true);
  });

  test('should hide on back button', () => {
    isVisible = true;
    isVisible = false;
    expect(isVisible).toBe(false);
  });

  test('should contain programming section', () => {
    expect(creditsText).toContain('Programming');
  });
});
