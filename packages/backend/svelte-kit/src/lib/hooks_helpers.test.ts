// packages/backend/svelte-kit/src/lib/hooks_helpers.test.ts
//
// Unit tests for the pure request/logging helpers extracted from
// apps/frontend/hub — isPathExcluded, isAikamiWebOrigin (the
// *.bearlysleeping.com CORS allowance for /api/internal_logging) and
// sanitizeLogAppTag (the `app` tag cap for browser log ingestion).

import { describe, expect, it } from 'bun:test';
import { isAikamiWebOrigin, isPathExcluded, sanitizeLogAppTag } from './hooks_helpers.ts';

describe('isPathExcluded', () => {
  const excluded = ['/api/internal_logging'];

  it('matches an exact excluded path', () => {
    expect(isPathExcluded('/api/internal_logging', excluded)).toBe(true);
  });

  it('matches a path that starts with the excluded path followed by /', () => {
    expect(isPathExcluded('/api/internal_logging/sub', excluded)).toBe(true);
    expect(isPathExcluded('/api/internal_logging/deep/route', excluded)).toBe(true);
  });

  it('rejects bare prefix lookalikes (no trailing /)', () => {
    expect(isPathExcluded('/api/internal_logging_extra', excluded)).toBe(false);
    expect(isPathExcluded('/api/internal_loggings', excluded)).toBe(false);
  });

  it('rejects unrelated paths', () => {
    expect(isPathExcluded('/api/auth/session', excluded)).toBe(false);
    expect(isPathExcluded('/', excluded)).toBe(false);
  });

  it('handles an empty exclusion list', () => {
    expect(isPathExcluded('/api/internal_logging', [])).toBe(false);
  });
});

describe('isAikamiWebOrigin', () => {
  it('accepts first-party https *.bearlysleeping.com origins', () => {
    expect(isAikamiWebOrigin('https://aikami.bearlysleeping.com')).toBe(true);
    expect(isAikamiWebOrigin('https://hub.stg.bearlysleeping.com')).toBe(true);
    expect(isAikamiWebOrigin('https://hub.bearlysleeping.com')).toBe(true);
    expect(isAikamiWebOrigin('https://a.b.c.bearlysleeping.com')).toBe(true);
  });

  it('accepts subdomains with digits and hyphens', () => {
    expect(isAikamiWebOrigin('https://my-app-2.bearlysleeping.com')).toBe(true);
  });

  it('rejects non-bearlysleeping.com hosts', () => {
    expect(isAikamiWebOrigin('https://evil.com')).toBe(false);
    expect(isAikamiWebOrigin('https://bearlysleeping.com.evil.com')).toBe(false);
    expect(isAikamiWebOrigin('https://notbearlysleeping.com')).toBe(false);
  });

  it('rejects non-https schemes', () => {
    expect(isAikamiWebOrigin('http://aikami.bearlysleeping.com')).toBe(false);
    expect(isAikamiWebOrigin('ws://aikami.bearlysleeping.com')).toBe(false);
  });

  it('rejects the bare apex domain (needs at least one subdomain label)', () => {
    expect(isAikamiWebOrigin('https://bearlysleeping.com')).toBe(false);
  });

  it('rejects null, undefined and empty strings', () => {
    expect(isAikamiWebOrigin(null)).toBe(false);
    expect(isAikamiWebOrigin(undefined)).toBe(false);
    expect(isAikamiWebOrigin('')).toBe(false);
  });

  it('rejects ports, paths and userinfo', () => {
    expect(isAikamiWebOrigin('https://aikami.bearlysleeping.com:8443')).toBe(false);
    expect(isAikamiWebOrigin('https://aikami.bearlysleeping.com/path')).toBe(false);
    expect(isAikamiWebOrigin('https://user@aikami.bearlysleeping.com')).toBe(false);
  });

  it('acts as a type predicate: narrows the true branch to string', () => {
    const origin: string | null | undefined = 'https://hub.stg.bearlysleeping.com';
    if (isAikamiWebOrigin(origin)) {
      // In this branch TS narrows origin to `string` — compile-time check.
      expect(origin.startsWith('https://')).toBe(true);
    }
  });
});

describe('sanitizeLogAppTag', () => {
  it('passes a valid short app id through unchanged', () => {
    expect(sanitizeLogAppTag('client')).toBe('client');
    expect(sanitizeLogAppTag('hub')).toBe('hub');
  });

  it('passes a 64-char tag through (boundary)', () => {
    const tag = 'a'.repeat(64);
    expect(sanitizeLogAppTag(tag)).toBe(tag);
  });

  it('returns undefined for an over-64-char tag', () => {
    expect(sanitizeLogAppTag('a'.repeat(65))).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(sanitizeLogAppTag('')).toBeUndefined();
  });

  it('returns undefined for non-string values', () => {
    expect(sanitizeLogAppTag(null)).toBeUndefined();
    expect(sanitizeLogAppTag(undefined)).toBeUndefined();
    expect(sanitizeLogAppTag(42)).toBeUndefined();
    expect(sanitizeLogAppTag({ app: 'client' })).toBeUndefined();
    expect(sanitizeLogAppTag(['client'])).toBeUndefined();
  });
});
