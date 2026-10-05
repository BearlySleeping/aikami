// apps/e2e/tests/client/optional_runtime_config_errors.spec.ts
// Negative controls for the one documented C-389 optional-document exception.

import { expect, test } from '@playwright/test';
import {
  isObservedOptionalRuntimeConfig404,
  isOptionalRuntimeConfig404,
} from '../../src/optional_runtime_config_errors.ts';

const ORIGIN = 'http://localhost:10884';
const CONFIG = `${ORIGIN}/config.json`;
const ERROR_404 = 'Failed to load resource: the server responded with a status of 404 (Not Found)';
const observed404 = { url: CONFIG, status: 404 };

test.describe('World Generation Wizard — optional config attribution', () => {
  test('only an observed same-origin optional-document 404 is expected', () => {
    expect(isOptionalRuntimeConfig404(observed404, ORIGIN)).toBe(true);
    for (const response of [
      { url: CONFIG, status: 403 },
      { url: CONFIG, status: 500 },
      { url: `${ORIGIN}/missing-entity.png`, status: 404 },
      { url: 'https://other.example/config.json', status: 404 },
      { url: `${CONFIG}?unrelated=1`, status: 404 },
      { url: 'not-a-url', status: 404 },
    ]) {
      expect(isOptionalRuntimeConfig404(response, ORIGIN)).toBe(false);
    }
  });

  test('generic, URL-less, unobserved and unrelated console errors remain failures', () => {
    expect(
      isObservedOptionalRuntimeConfig404({
        error: { url: CONFIG, text: ERROR_404 },
        responses: [observed404],
        appOrigin: ORIGIN,
      }),
    ).toBe(true);
    for (const error of [
      { url: CONFIG, text: 'Failed to load resource' },
      { url: '', text: ERROR_404 },
      { url: `${ORIGIN}/missing-entity.png`, text: ERROR_404 },
      { url: 'https://other.example/config.json', text: ERROR_404 },
      { url: CONFIG, text: 'Uncaught TypeError: the draft failed to load' },
      {
        url: CONFIG,
        text: 'Failed to load resource: the server responded with a status of 500 (Error)',
      },
      {
        url: CONFIG,
        text: 'Failed to load resource: the server responded with a status of 403 (Forbidden)',
      },
    ]) {
      expect(
        isObservedOptionalRuntimeConfig404({ error, responses: [observed404], appOrigin: ORIGIN }),
      ).toBe(false);
    }
    expect(
      isObservedOptionalRuntimeConfig404({
        error: { url: CONFIG, text: ERROR_404 },
        responses: [],
        appOrigin: ORIGIN,
      }),
    ).toBe(false);
    expect(
      isObservedOptionalRuntimeConfig404({
        error: { url: CONFIG, text: ERROR_404 },
        responses: [{ url: CONFIG, status: 500 }],
        appOrigin: ORIGIN,
      }),
    ).toBe(false);
  });
});
