// apps/frontend/client/src/app_fonts.test.ts
//
// C-527 AC-6 — the game must render with NO network. Fonts are the classic
// silent online dependency: a remote `@import`, a `<link>` to a font CDN or a
// `@font-face` with an `http(s)` src all work perfectly in development and turn
// the first paint into a blocking request on a disconnected device.
//
// This asserts the offline guarantee on the actual stylesheet and document
// shell, so a future "just add Inter from the CDN" cannot land unnoticed.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CLIENT_ROOT = resolve(import.meta.dirname, '..');

const read = (relativePath: string): string =>
  readFileSync(resolve(CLIENT_ROOT, relativePath), 'utf8');

/** Origins that would make first paint depend on the network. */
const REMOTE_FONT_HOSTS = /fonts\.(googleapis|gstatic)\.com|use\.typekit|cdn\.jsdelivr|unpkg\.com/i;

describe('C-527 offline font delivery', () => {
  const css = read('src/app.css');

  test('the stylesheet makes no remote font request', () => {
    expect(REMOTE_FONT_HOSTS.test(css)).toBe(false);
    // A remote @import or an http(s) url() in a font context would both fetch.
    expect(css).not.toMatch(/@import\s+url\(\s*['"]?https?:/i);
    expect(css).not.toMatch(/@font-face[\s\S]*?url\(\s*['"]?https?:/i);
  });

  test('the font roles declare a local fallback chain, not a single family', () => {
    const sans = css.match(/--font-sans:\s*([^;]+);/)?.[1];
    const display = css.match(/--font-display:\s*([^;]+);/)?.[1];

    expect(sans).toBeDefined();
    expect(display).toBeDefined();
    // A single family with no generic fallback hands the last word to the
    // browser's default face, which is not a "documented fallback".
    for (const chain of [sans ?? '', display ?? '']) {
      expect(chain.split(',').length).toBeGreaterThanOrEqual(2);
      expect(chain).toMatch(/serif|sans-serif|system-ui|monospace/);
    }
  });

  test('the document shell links no font stylesheet', () => {
    for (const file of ['src/app.html', 'src/app.css']) {
      const contents = read(file);
      expect(REMOTE_FONT_HOSTS.test(contents)).toBe(false);
    }
    expect(read('src/app.html')).not.toMatch(
      /<link[^>]+rel=["']?(preconnect|stylesheet)["']?[^>]+fonts/i,
    );
  });

  test('the game theme does not depend on the client stylesheet for fonts', () => {
    // The theme package is imported by hub, site and docs too. A font declared
    // there would silently add a network dependency to every surface, which
    // AC-6 explicitly forbids for the unrelated apps.
    const themeCss = readFileSync(
      resolve(CLIENT_ROOT, '../../../packages/frontend/theme/src/lib/aikami_theme.css'),
      'utf8',
    );
    expect(REMOTE_FONT_HOSTS.test(themeCss)).toBe(false);
    expect(themeCss).not.toMatch(/@font-face[\s\S]*?url\(\s*['"]?https?:/i);
  });
});
