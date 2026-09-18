// scripts/src/lib/dist/__tests__/upload_ort.test.ts
//
// Focused tests for the ORT dist-plane publisher's pure logic:
//   - the versioned public URL each object must be reachable at,
//   - the response-header contract a browser needs (Content-Type,
//     immutable cache, CORS).
//
// The network calls stay untested; these pin the expectations so a version
// bump or a bucket misconfiguration is caught by a fast unit test as well as
// by the publisher's own verification pass.

import { describe, expect, test } from 'bun:test';
import { ORT_RUNTIME_VERSION, ORT_RUNTIME_FILES } from '@aikami/constants';
import {
  checkPublishedObject,
  contentTypeFor,
  publishedObjectExpectations,
} from '../upload_ort.ts';

describe('contentTypeFor', () => {
  test('serves .mjs as text/javascript', () => {
    expect(contentTypeFor('ort-wasm-simd-threaded.jsep.mjs')).toBe('text/javascript');
  });

  test('serves .wasm as application/wasm', () => {
    expect(contentTypeFor('ort-wasm-simd-threaded.jsep.wasm')).toBe('application/wasm');
  });
});

describe('publishedObjectExpectations', () => {
  test('builds a version-pinned URL for every published object', () => {
    const expectations = publishedObjectExpectations('https://dl.example.com');
    expect(expectations).toHaveLength(ORT_RUNTIME_FILES.length);
    for (const expectation of expectations) {
      expect(expectation.url).toBe(
        `https://dl.example.com/models/ort/${ORT_RUNTIME_VERSION}/${expectation.filename}`,
      );
      expect(expectation.contentType).toBe(contentTypeFor(expectation.filename));
    }
  });

  test('normalises a trailing slash on the origin', () => {
    const withSlash = publishedObjectExpectations('https://dl.example.com/');
    const without = publishedObjectExpectations('https://dl.example.com');
    expect(withSlash.map((e) => e.url)).toEqual(without.map((e) => e.url));
  });

  test('includes both variants and both kinds', () => {
    const names = publishedObjectExpectations('https://dl.example.com').map(
      (e) => e.filename,
    );
    expect(names).toContain('ort-wasm-simd-threaded.jsep.mjs');
    expect(names).toContain('ort-wasm-simd-threaded.jsep.wasm');
    expect(names).toContain('ort-wasm-simd-threaded.asyncify.mjs');
    expect(names).toContain('ort-wasm-simd-threaded.asyncify.wasm');
  });
});

describe('checkPublishedObject', () => {
  const expectation = {
    filename: 'ort-wasm-simd-threaded.jsep.wasm',
    url: 'https://dl.example.com/models/ort/x/ort-wasm-simd-threaded.jsep.wasm',
    contentType: 'application/wasm',
  };

  test('passes a fully-correct response', () => {
    const check = checkPublishedObject(expectation, {
      status: 200,
      contentType: 'application/wasm',
      cacheControl: 'public, max-age=31536000, immutable',
      allowOrigin: 'https://aikami.bearlysleeping.com',
    });
    expect(check.ok).toBe(true);
    expect(check.problems).toEqual([]);
  });

  test('fails when CORS is missing', () => {
    const check = checkPublishedObject(expectation, {
      status: 200,
      contentType: 'application/wasm',
      cacheControl: 'public, max-age=31536000, immutable',
      allowOrigin: null,
    });
    expect(check.ok).toBe(false);
    expect(check.problems.some((p) => p.includes('Access-Control-Allow-Origin'))).toBe(true);
  });

  test('fails on a wrong Content-Type', () => {
    const check = checkPublishedObject(expectation, {
      status: 200,
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
      allowOrigin: '*',
    });
    expect(check.ok).toBe(false);
    expect(check.problems.some((p) => p.includes('Content-Type'))).toBe(true);
  });

  test('fails when the cache is not immutable', () => {
    const check = checkPublishedObject(expectation, {
      status: 200,
      contentType: 'application/wasm',
      cacheControl: 'public, max-age=0',
      allowOrigin: '*',
    });
    expect(check.ok).toBe(false);
    expect(check.problems.some((p) => p.includes('immutable'))).toBe(true);
  });

  test('fails on a non-200 status', () => {
    const check = checkPublishedObject(expectation, {
      status: 404,
      contentType: null,
      cacheControl: null,
      allowOrigin: null,
    });
    expect(check.ok).toBe(false);
    expect(check.problems.some((p) => p.includes('200'))).toBe(true);
  });
});
