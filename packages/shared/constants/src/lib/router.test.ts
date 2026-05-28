import { describe, expect, test } from 'bun:test';
import { REDIRECT_TO_URL_SEARCH_PARAM_KEY } from './router.ts';

describe('REDIRECT_TO_URL_SEARCH_PARAM_KEY', () => {
  test('should be a non-empty string', () => {
    expect(typeof REDIRECT_TO_URL_SEARCH_PARAM_KEY).toBe('string');
    expect(REDIRECT_TO_URL_SEARCH_PARAM_KEY.length).toBeGreaterThan(0);
  });

  test('should have correct value', () => {
    expect(REDIRECT_TO_URL_SEARCH_PARAM_KEY).toBe('goto');
  });
});
