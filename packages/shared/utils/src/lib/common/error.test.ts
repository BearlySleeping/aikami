import { describe, expect, test } from 'bun:test';
import type { AppError, ErrorType } from '@aikami/types';
import { toAppError, toAppErrorFromUnknownError, toHttpErrorStatusCode } from './error.ts';

describe('toHttpErrorStatusCode', () => {
  const errorTypeToStatusCode = [
    ['cancelled', 499],
    ['invalid-argument', 400],
    ['deadline-exceeded', 504],
    ['not-found', 404],
    ['already-exists', 409],
    ['permission-denied', 403],
    ['resource-exhausted', 429],
    ['failed-precondition', 400],
    ['aborted', 409],
    ['out-of-range', 400],
    ['unimplemented', 501],
    ['unavailable', 503],
    ['unauthenticated', 401],
  ] as const;

  for (const [errorType, expectedStatusCode] of errorTypeToStatusCode) {
    test(`should return ${expectedStatusCode} for ${errorType}`, () => {
      expect(toHttpErrorStatusCode(errorType)).toBe(expectedStatusCode);
    });
  }

  test('should return 500 for unknown error type', () => {
    expect(toHttpErrorStatusCode('unknown' as ErrorType)).toBe(500);
  });
});

describe('toAppError', () => {
  test('should create an Error with correct cause', () => {
    const error = toAppError({
      errorType: 'not-found',
      errorMessage: 'Resource not found',
      details: { extra: 'data' },
    });

    expect(error.message).toBe('Resource not found');
    expect(error.cause).toBeDefined();
    const cause = error.cause as AppError['cause'];
    expect(cause.errorType).toBe('not-found');
    expect(cause.statusCode).toBe(404);
    expect(cause.details).toEqual({ extra: 'data' });
  });

  test('should create error without details', () => {
    const error = toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'Invalid input',
    });

    expect(error.message).toBe('Invalid input');
    const cause = error.cause as AppError['cause'];
    expect(cause.errorType).toBe('invalid-argument');
    expect(cause.statusCode).toBe(400);
    expect(cause.details).toBeUndefined();
  });
});

describe('toAppErrorFromUnknownError', () => {
  test('should convert Error instance to AppError', () => {
    const originalError = new Error('Original error');
    originalError.cause = {
      errorType: 'permission-denied' as const,
      statusCode: 403,
      details: { extra: 'info' },
    };

    const appError = toAppErrorFromUnknownError(originalError);

    expect(appError.message).toBe('Original error');
    expect(appError.cause.errorType).toBe('permission-denied');
    expect(appError.cause.statusCode).toBe(403);
    expect(appError.cause.details).toEqual({ extra: 'info' });
  });

  test('should handle plain string error', () => {
    const appError = toAppErrorFromUnknownError('String error');

    expect(appError.message).toBe('Unknown error');
    expect(appError.cause.errorType).toBe('unknown');
    expect(appError.cause.statusCode).toBe(500);
  });

  test('should handle null error', () => {
    const appError = toAppErrorFromUnknownError(null);

    expect(appError.message).toBe('Unknown error');
    expect(appError.cause.errorType).toBe('unknown');
    expect(appError.cause.statusCode).toBe(500);
    expect(appError.cause.details).toBeNull();
  });

  test('should handle Error without cause', () => {
    const originalError = new Error('Error without cause');
    const appError = toAppErrorFromUnknownError(originalError);

    expect(appError.message).toBe('Error without cause');
    expect(appError.cause.errorType).toBe('unknown');
    expect(appError.cause.statusCode).toBe(500);
  });
});
