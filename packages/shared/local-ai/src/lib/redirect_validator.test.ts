// packages/shared/local-ai/src/lib/redirect_validator.test.ts
import { describe, expect, test } from 'bun:test';
import {
  dropCredentialsIfCrossOrigin,
  isPrivateOrLinkLocalHost,
  MAX_REDIRECT_HOPS,
  validateRedirectChain,
  validateRedirectHop,
} from './redirect_validator.ts';

describe('isPrivateOrLinkLocalHost', () => {
  test('127.0.0.1 is private', () => {
    expect(isPrivateOrLinkLocalHost('127.0.0.1')).toBe(true);
  });

  test('localhost is private', () => {
    expect(isPrivateOrLinkLocalHost('localhost')).toBe(true);
  });

  test('10.x.x.x is private', () => {
    expect(isPrivateOrLinkLocalHost('10.0.0.1')).toBe(true);
  });

  test('192.168.x.x is private', () => {
    expect(isPrivateOrLinkLocalHost('192.168.1.1')).toBe(true);
  });

  test('172.16.x.x is private', () => {
    expect(isPrivateOrLinkLocalHost('172.16.0.1')).toBe(true);
  });

  test('169.254.x.x is link-local', () => {
    expect(isPrivateOrLinkLocalHost('169.254.1.1')).toBe(true);
  });

  test('::1 is private', () => {
    expect(isPrivateOrLinkLocalHost('::1')).toBe(true);
  });

  test('fe80:: prefix is link-local', () => {
    expect(isPrivateOrLinkLocalHost('fe80::1')).toBe(true);
  });

  test('fc00:: prefix is private (ULA)', () => {
    expect(isPrivateOrLinkLocalHost('fc00::1')).toBe(true);
  });

  test('public host is not private', () => {
    expect(isPrivateOrLinkLocalHost('huggingface.co')).toBe(false);
  });

  test('CDN host is not private', () => {
    expect(isPrivateOrLinkLocalHost('cdn-lfs.huggingface.co')).toBe(false);
  });

  test('0.0.0.0 is private', () => {
    expect(isPrivateOrLinkLocalHost('0.0.0.0')).toBe(true);
  });
});

describe('validateRedirectHop', () => {
  const initialUrl = new URL(
    'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
  );

  test('allows a valid redirect to an approved CDN host', () => {
    const result = validateRedirectHop({
      location: 'https://cdn-lfs.huggingface.co/repos/ab/12/abc123/file.gguf',
      fromUrl: initialUrl,
      hopCount: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url.hostname).toBe('cdn-lfs.huggingface.co');
    }
  });

  test('drops username-only credentials from a cross-origin redirect', () => {
    const result = validateRedirectHop({
      location: 'https://user@cdn-lfs.huggingface.co/file.gguf',
      fromUrl: initialUrl,
      hopCount: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url.username).toBe('');
      expect(result.url.password).toBe('');
    }
  });

  test('drops password-only credentials from a cross-origin redirect', () => {
    const result = validateRedirectHop({
      location: 'https://:pass@cdn-lfs.huggingface.co/file.gguf',
      fromUrl: initialUrl,
      hopCount: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url.username).toBe('');
      expect(result.url.password).toBe('');
    }
  });

  test('rejects HTTP downgrade from HTTPS', () => {
    const result = validateRedirectHop({
      location: 'http://cdn-lfs.huggingface.co/file.gguf',
      fromUrl: initialUrl,
      hopCount: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('downgrade');
    }
  });

  test('rejects redirect to private host', () => {
    const result = validateRedirectHop({
      location: 'https://localhost:8080/file.gguf',
      fromUrl: initialUrl,
      hopCount: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('private');
    }
  });

  test('rejects redirect to unapproved host', () => {
    const result = validateRedirectHop({
      location: 'https://evil.example.com/file.gguf',
      fromUrl: initialUrl,
      hopCount: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('unapproved');
    }
  });

  test('rejects redirect that exceeds hop cap', () => {
    const result = validateRedirectHop({
      location: 'https://cdn-lfs.huggingface.co/file.gguf',
      fromUrl: initialUrl,
      hopCount: MAX_REDIRECT_HOPS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('exceeded');
    }
  });

  test('rejects invalid URL', () => {
    const result = validateRedirectHop({
      location: ':::invalid',
      fromUrl: initialUrl,
      hopCount: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('invalid');
    }
  });

  test('allows subdomain of approved host', () => {
    const result = validateRedirectHop({
      location: 'https://files.huggingface.co/file.gguf',
      fromUrl: initialUrl,
      hopCount: 0,
    });
    expect(result.ok).toBe(true);
  });

  test('rejects redirect to non-default port when origin specifies default', () => {
    const result = validateRedirectHop({
      location: 'https://huggingface.co:8080/file.gguf',
      fromUrl: initialUrl,
      hopCount: 0,
    });
    expect(result.ok).toBe(false);
  });

  test('rejects redirect with unsupported protocol', () => {
    const result = validateRedirectHop({
      location: 'ftp://huggingface.co/file.gguf',
      fromUrl: initialUrl,
      hopCount: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('unsupported');
    }
  });
});

describe('validateRedirectChain', () => {
  test('accepts a valid multi-hop CDN chain', () => {
    const result = validateRedirectChain({
      initialUrl:
        'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/model.gguf',
      redirectLocations: [
        'https://cdn-lfs.huggingface.co/repos/ab/12/file.gguf',
        'https://objects.githubusercontent.com/file.gguf',
      ],
    });
    expect(result.ok).toBe(true);
  });

  test('rejects a chain where any hop is invalid', () => {
    const result = validateRedirectChain({
      initialUrl:
        'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/model.gguf',
      redirectLocations: [
        'https://cdn-lfs.huggingface.co/repos/ab/12/file.gguf',
        'http://evil.example.com/file.gguf', // downgrade + unapproved
      ],
    });
    expect(result.ok).toBe(false);
  });

  test('rejects a chain that exceeds the hop cap', () => {
    const result = validateRedirectChain({
      initialUrl: 'https://huggingface.co/model.gguf',
      redirectLocations: [
        'https://cdn-lfs.huggingface.co/a.gguf',
        'https://objects.githubusercontent.com/b.gguf',
        'https://cdn-lfs.huggingface.co/c.gguf',
        'https://objects.githubusercontent.com/d.gguf',
        'https://cdn-lfs.huggingface.co/e.gguf',
        'https://objects.githubusercontent.com/f.gguf', // 6th hop
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('exceeded');
    }
  });

  test('rejects an invalid initial URL', () => {
    const result = validateRedirectChain({
      initialUrl: ':::bad',
      redirectLocations: [],
    });
    expect(result.ok).toBe(false);
  });

  test('accepts a chain with no redirects (empty list)', () => {
    const result = validateRedirectChain({
      initialUrl: 'https://huggingface.co/model.gguf',
      redirectLocations: [],
    });
    expect(result.ok).toBe(true);
  });
});

describe('dropCredentialsIfCrossOrigin', () => {
  test('drops credentials when cross-origin', () => {
    const url = new URL('https://user:pass@cdn-lfs.huggingface.co/file.gguf');
    const result = dropCredentialsIfCrossOrigin(url, 'https://huggingface.co');
    expect(result.username).toBe('');
    expect(result.password).toBe('');
  });

  test('preserves credentials when same-origin', () => {
    const url = new URL('https://user:pass@huggingface.co/file.gguf');
    const result = dropCredentialsIfCrossOrigin(url, 'https://huggingface.co');
    expect(result.username).toBe('user');
  });

  test('preserves a URL with no credentials', () => {
    const url = new URL('https://huggingface.co/file.gguf');
    const result = dropCredentialsIfCrossOrigin(url, 'https://huggingface.co');
    expect(result.href).toBe(url.href);
  });
});
