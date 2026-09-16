// apps/frontend/client/src/lib/services/theme/theme_install_intent.test.ts
//
// C-530 AC-5 / AC-7 — the handoff parser accepts an identity and nothing else.
//
// The rejections are the point: a deep link is attacker-reachable input, so a
// link that names an origin, a path or an executable must parse to `undefined`
// rather than to a fetchable source.

import { describe, expect, test } from 'bun:test';
import {
  buildThemeInstallDeepLink,
  parseThemeInstallIntent,
  themePackageUrl,
} from './theme_install_intent.ts';

describe('C-530 AC-5: a well-formed handoff yields a trusted identity', () => {
  test('accepts the deep-link query form', () => {
    expect(parseThemeInstallIntent('aikami://theme/obsidian-chronicle?version=1.2.0')).toEqual({
      themeId: 'obsidian-chronicle',
      version: '1.2.0',
      source: 'configured-hub',
    });
  });

  test('accepts the deep-link @ form', () => {
    expect(parseThemeInstallIntent('aikami://theme/obsidian-chronicle@1.2.0')).toEqual({
      themeId: 'obsidian-chronicle',
      version: '1.2.0',
      source: 'configured-hub',
    });
  });

  test('accepts the same-origin hub path form', () => {
    expect(
      parseThemeInstallIntent('/community/themes/obsidian-chronicle?version=1.2.0'),
    ).toEqual({
      themeId: 'obsidian-chronicle',
      version: '1.2.0',
      source: 'configured-hub',
    });
  });

  test('the payload never carries a URL or a path', () => {
    const intent = parseThemeInstallIntent('aikami://theme/obsidian-chronicle?version=1.2.0');
    expect(intent).toBeDefined();
    expect(Object.keys(intent ?? {}).sort()).toEqual(['source', 'themeId', 'version']);
    expect(JSON.stringify(intent)).not.toContain('http');
    expect(JSON.stringify(intent)).not.toContain('/');
  });

  test('the package URL is derived from the configured hub base, not the link', () => {
    const intent = parseThemeInstallIntent('aikami://theme/obsidian-chronicle?version=1.2.0');
    expect(intent).toBeDefined();
    if (intent === undefined) {
      return;
    }
    expect(themePackageUrl(intent, 'https://hub.example/api/')).toBe(
      'https://hub.example/api/assets/themes/obsidian-chronicle/public?version=1.2.0',
    );
  });

  test('round-trips through the canonical deep link', () => {
    const intent = { themeId: 'obsidian-chronicle', version: '1.2.0', source: 'configured-hub' } as const;
    expect(parseThemeInstallIntent(buildThemeInstallDeepLink(intent))).toEqual(intent);
  });
});

describe('C-530 AC-7: a hostile handoff parses to undefined', () => {
  const rejected = [
    'https://evil.example/theme.zip',
    'http://evil.example/theme.zip',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'aikami://other/obsidian-chronicle?version=1.2.0',
    'aikami://theme/../etc/passwd?version=1.2.0',
    'aikami://theme/%2e%2e/etc?version=1.2.0',
    'aikami://theme/obsidian-chronicle',
    'aikami://theme/obsidian-chronicle?version=not-a-version',
    'aikami://theme/obsidian-chronicle?version=1.2',
    'aikami://theme/obsidian-chronicle?url=https://evil.example/x.zip&version=1.2.0',
    'aikami://theme/obsidian-chronicle?version=1.2.0&path=/etc/passwd',
    'aikami://theme/Bad_Id?version=1.2.0',
    'aikami://theme/obsidian-chronicle/extra?version=1.2.0',
    '/community/themes/../../etc/passwd?version=1.2.0',
    '/community/themes/obsidian-chronicle',
    '/community/themes/obsidian-chronicle?version=1.2',
    '/other/path/obsidian-chronicle?version=1.2.0',
    '',
    '   ',
  ];

  for (const raw of rejected) {
    test(`rejects ${JSON.stringify(raw)}`, () => {
      expect(parseThemeInstallIntent(raw)).toBeUndefined();
    });
  }
});
