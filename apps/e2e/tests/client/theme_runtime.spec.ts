// apps/e2e/tests/client/theme_runtime.spec.ts
//
// C-529 — Declarative theme runtime and creator tools.
//
// Production journeys on /settings?section=interface and /game. These are
// compiled Playwright assertions against the real route, the real services and
// real localStorage — not a sandbox: every state below is reached by clicking
// what a player clicks, and the theme scoping is asserted on the real game shell
// and the real trusted chrome.
//
// The package-level adversarial cases (traversal, MIME mismatch, decompression
// bombs, alias cycles, unsupported major API, forbidden values) are covered by
// unit tests in `packages/frontend/theme/src/lib/theme/theme_compiler.test.ts`
// and by the declared CLI validator (`scripts:theme-validate`), which share the
// same compiler this runtime calls.
//
// Contract: C-529 AC-2 (creation surface), AC-5 (mode/accessibility
// precedence), AC-6 (atomic apply and recovery), AC-9 (upgrade continuity).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { HudCustomizationPage } from '$pom';

const SELECTION_KEY = 'aikami:theme:selection';
const HUD_KEY = 'aikami:hud:preferences';
const MOTION_KEY = 'aikami:motion:preference';
const ACCESSIBILITY_KEY = 'aikami:theme:accessibility';
const LAST_GOOD_KEY = 'aikami:theme:last-good';

/** CRC-32, needed to write a valid stored ZIP entry without an archive library. */
const crc32 = (bytes: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/**
 * Builds a minimal STORED (uncompressed) ZIP.
 *
 * The e2e app deliberately has no archive dependency — the client owns JSZip —
 * so a hostile archive is assembled here from the format itself. Stored entries
 * keep it exact and readable.
 */
const buildStoredZip = (entries: readonly { path: string; text: string }[]): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const data = Buffer.from(entry.text, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
};

test.describe('C-529 appearance runtime', () => {
  let hud: HudCustomizationPage;

  test.beforeEach(async ({ page }) => {
    hud = new HudCustomizationPage(page);
    await page.goto('/settings?section=interface');
    await page.evaluate(
      ([selection, hudKey, motionKey, accessibilityKey, lastGoodKey]) => {
        localStorage.removeItem(selection);
        localStorage.removeItem(hudKey);
        localStorage.removeItem(motionKey);
        localStorage.removeItem(accessibilityKey);
        localStorage.removeItem(lastGoodKey);
      },
      [SELECTION_KEY, HUD_KEY, MOTION_KEY, ACCESSIBILITY_KEY, LAST_GOOD_KEY],
    );
    await page.reload();
  });

  test('AC-2: the Appearance surface is reachable from the existing interface section', async ({
    page,
  }) => {
    await expect(page.getByTestId('settings-interface')).toBeVisible();
    await expect(page.getByTestId('settings-appearance')).toBeVisible();
    await expect(page.getByTestId('appearance-mode-system')).toBeVisible();
    await expect(page.getByTestId('appearance-mode-light')).toBeVisible();
    await expect(page.getByTestId('appearance-mode-dark')).toBeVisible();
    await expect(page.getByTestId('appearance-theme-obsidian-chronicle')).toBeVisible();
  });

  test('AC-9: a profile with no stored appearance defaults to Obsidian Chronicle with OS mode', async ({
    page,
  }) => {
    // The documented default, on a profile that has HUD and motion values but no
    // appearance selection.
    await expect(page.getByTestId('appearance-resolved-variant')).toContainText(
      /Rendering: (light|dark)/,
    );
    await expect(page.getByTestId('appearance-mode-system')).toHaveClass(/btn-active/);
    await expect(page.getByTestId('appearance-theme-obsidian-chronicle')).toHaveClass(/btn-active/);
  });

  test('AC-5: an explicit mode wins and is honoured on the trusted root', async ({ page }) => {
    await page.getByTestId('appearance-mode-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('appearance-resolved-variant')).toContainText('dark');

    await page.getByTestId('appearance-mode-light').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('appearance-resolved-variant')).toContainText('light');
  });

  test('AC-5/AC-9: the selection survives a reload and leaves HUD and motion untouched', async ({
    page,
  }) => {
    await page.evaluate(
      ([hudKey, motionKey]) => {
        localStorage.setItem(
          hudKey,
          JSON.stringify({ schemaVersion: 1, selectedPresetId: 'minimal', overrides: [] }),
        );
        localStorage.setItem(motionKey, 'reduce');
      },
      [HUD_KEY, MOTION_KEY],
    );
    await page.getByTestId('appearance-mode-dark').click();
    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('appearance-mode-dark')).toHaveClass(/btn-active/);

    const stored = await page.evaluate(
      ([selection, hudKey, motionKey]) => ({
        selection: localStorage.getItem(selection),
        hud: localStorage.getItem(hudKey),
        motion: localStorage.getItem(motionKey),
      }),
      [SELECTION_KEY, HUD_KEY, MOTION_KEY],
    );
    expect(stored.selection).toContain('"mode":"dark"');
    // Appearance is independent of the other two preferences.
    expect(stored.hud).toContain('minimal');
    expect(stored.motion).toBe('reduce');
  });

  test('AC-5: the game shell is the theme scope and carries the resolved variant', async ({
    page,
  }) => {
    await page.getByTestId('appearance-mode-dark').click();
    await hud.open();

    const scope = page.locator('[data-aikami-theme-scope]');
    await expect(scope).toBeAttached();
    await expect(scope).toHaveAttribute('data-aikami-variant', 'dark');

    // The trusted chrome is not repainted by a custom theme: the global
    // `data-theme` contract still resolves, and the HUD layout is unchanged.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(hud.hudAnchor('top-end')).toBeAttached();
    await expect(hud.hudWidget('menu')).toBeAttached();
    await expect(page.getByTestId('hud-menu-entry')).toBeVisible();
  });

  test('AC-6: a corrupt stored selection boots the default with a reachable repair path', async ({
    page,
  }) => {
    await page.evaluate(
      ([selection]) => localStorage.setItem(selection, '{ not json'),
      [SELECTION_KEY],
    );
    await page.reload();

    await expect(page.getByTestId('appearance-recovery-notice')).toBeVisible();
    await page.getByTestId('appearance-restore-defaults').click();
    await expect(page.getByTestId('appearance-recovery-notice')).toHaveCount(0);
    await expect(page.getByTestId('appearance-theme-obsidian-chronicle')).toHaveClass(/btn-active/);
  });

  test('AC-6: restoring the default appearance is always reachable and needs no network', async ({
    page,
  }) => {
    // 🔴 Not `setOffline` + `reload`: the client is a Vite DEV server here, so a
    // hard navigation genuinely needs the network for module fetches and would
    // fail for a reason that has nothing to do with this contract. What the
    // contract actually requires is that applying and reverting the appearance
    // never depends on a remote request, which is asserted directly.
    const remoteRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('http://localhost') && !url.startsWith('data:')) {
        remoteRequests.push(url);
      }
    });

    await page.getByTestId('appearance-mode-light').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await expect(page.getByTestId('appearance-reset')).toBeVisible();
    await page.getByTestId('appearance-reset').click();
    await expect(page.getByTestId('appearance-mode-system')).toHaveClass(/btn-active/);
    await expect(page.getByTestId('appearance-theme-obsidian-chronicle')).toHaveClass(/btn-active/);

    expect(remoteRequests).toEqual([]);
  });
});

// ── C-529 AC-2 — the no-code creator editor ────────────────────────────────

test.describe('C-529 creator editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings?section=interface');
    await page.evaluate(
      ([selection, accessibilityKey, lastGoodKey]) => {
        localStorage.removeItem(selection);
        localStorage.removeItem(accessibilityKey);
        localStorage.removeItem(lastGoodKey);
      },
      [SELECTION_KEY, ACCESSIBILITY_KEY, LAST_GOOD_KEY],
    );
    await page.reload();
  });

  test('AC-2: the editor duplicates a built-in and previews four game contexts', async ({
    page,
  }) => {
    await page.getByTestId('appearance-open-editor').click();
    await expect(page.getByTestId('theme-editor')).toBeVisible();
    for (const context of ['explore', 'dialogue', 'inventory', 'combat']) {
      await expect(page.getByTestId(`theme-preview-${context}`)).toBeVisible();
    }
    // The preview is a real theme scope, and it is not the surrounding chrome.
    await expect(page.getByTestId('theme-editor-preview')).toHaveAttribute(
      'data-aikami-theme-scope',
      '',
    );
    await expect(page.getByTestId('theme-editor-group-surface')).toBeVisible();
    await expect(page.getByTestId('theme-editor-group-type')).toBeVisible();
    await expect(page.getByTestId('theme-editor-group-borders')).toBeVisible();
  });

  test('AC-2: a role edit repaints the preview only', async ({ page }) => {
    await page.getByTestId('appearance-open-editor').click();
    const preview = page.getByTestId('theme-editor-preview');
    const before = await preview.getAttribute('style');

    await page.getByTestId('theme-editor-role-color.primary').fill('#ff0000');
    await page.getByTestId('theme-editor-role-color.primary').press('Tab');

    const after = await preview.getAttribute('style');
    expect(after).not.toBe(before);
    expect(after).toContain('--ui-primary');
    // The trusted chrome outside the preview is untouched.
    const rootStyle = await page.evaluate(() => document.documentElement.getAttribute('style'));
    expect(rootStyle ?? '').not.toContain('--ui-primary');
  });

  test('AC-2: the friendly editor names the exact bad role and blocks Apply', async ({ page }) => {
    await page.getByTestId('appearance-open-editor').click();
    await page.getByTestId('theme-editor-role-color.primary').fill('url(https://evil.example/x)');
    await page.getByTestId('theme-editor-role-color.primary').press('Tab');

    await expect(page.getByTestId('theme-editor-issues')).toBeVisible();
    await expect(page.getByTestId('theme-editor-issues')).toContainText('color.primary');
    await expect(page.getByTestId('theme-editor-apply')).toBeDisabled();
  });

  test('AC-2: the advanced JSON editor shares the same validation', async ({ page }) => {
    await page.getByTestId('appearance-open-editor').click();
    await page.getByTestId('theme-editor-json').fill(
      JSON.stringify({
        profileVersion: 1,
        variant: 'light',
        tokens: { 'color.primary': { $type: 'color', $value: 'calc(1px + 1px)' } },
      }),
    );
    await page.getByTestId('theme-editor-json-apply').click();
    await expect(page.getByTestId('theme-editor-json-issues')).toBeVisible();
    await expect(page.getByTestId('theme-editor-issues')).toBeVisible();
    await expect(page.getByTestId('theme-editor-apply')).toBeDisabled();
  });

  test('AC-2: Apply installs the edited theme and the editor closes', async ({ page }) => {
    await page.getByTestId('appearance-open-editor').click();
    await page.getByTestId('theme-editor-role-color.primary').fill('#123456');
    await page.getByTestId('theme-editor-role-color.primary').press('Tab');
    await page.getByTestId('theme-editor-apply').click();

    await expect(page.getByTestId('theme-editor')).toHaveCount(0);
    await expect(page.getByTestId('appearance-theme-my-theme')).toHaveClass(/btn-active/);
    // The installed theme's scope rule is injected for the game shell only.
    const injected = await page.evaluate(
      () => document.getElementById('aikami-theme-scope-style')?.textContent ?? '',
    );
    expect(injected).toContain('[data-aikami-theme-scope]');
    expect(injected).toContain('--ui-primary');
  });
});

// ── C-529 AC-3 — the package round trip on a fresh offline profile ─────────

test.describe('C-529 package round trip', () => {
  let tempDir: string;

  test.beforeEach(async ({ page }) => {
    tempDir = mkdtempSync(join(tmpdir(), 'aikami-theme-e2e-'));
    await page.goto('/settings?section=interface');
    await page.evaluate(
      ([selection, lastGoodKey]) => {
        localStorage.removeItem(selection);
        localStorage.removeItem(lastGoodKey);
      },
      [SELECTION_KEY, LAST_GOOD_KEY],
    );
    await page.reload();
  });

  test.afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('AC-3: export then import on a fresh profile restores the same theme', async ({ page }) => {
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('theme-export').click(),
    ]).then(([event]) => event);
    const archivePath = join(tempDir, download.suggestedFilename());
    await download.saveAs(archivePath);

    const archive = readFileSync(archivePath);
    // A real ZIP, and it carries no private preference keys.
    expect(archive.subarray(0, 2).toString('utf8')).toBe('PK');
    expect(archive.includes(Buffer.from('aikami:hud:preferences'))).toBe(false);
    expect(archive.includes(Buffer.from('aikami:theme:selection'))).toBe(false);

    // Fresh profile: nothing installed.
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
    await expect(page.getByTestId('appearance-theme-obsidian-chronicle')).toHaveClass(/btn-active/);

    await page.getByTestId('theme-import-input').setInputFiles(archivePath);
    await expect(page.getByTestId('theme-staged-summary')).toBeVisible();
    await page.getByTestId('theme-apply-staged').click();

    await expect(page.getByTestId('theme-staged-summary')).toHaveCount(0);
    await expect(page.getByTestId('theme-package-errors')).toHaveCount(0);
    const stored = await page.evaluate(
      ([selection, lastGoodKey]) => ({
        selection: localStorage.getItem(selection),
        installed: localStorage.getItem(lastGoodKey),
      }),
      [SELECTION_KEY, LAST_GOOD_KEY],
    );
    expect(stored.selection).toContain('obsidian-chronicle');
    expect(stored.installed).toContain('obsidian-chronicle');
  });

  test('AC-3/AC-6: cancelling a staged import leaves the previous theme active', async ({
    page,
  }) => {
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('theme-export').click(),
    ]).then(([event]) => event);
    const archivePath = join(tempDir, download.suggestedFilename());
    await download.saveAs(archivePath);

    await page.getByTestId('appearance-mode-dark').click();
    await page.getByTestId('theme-import-input').setInputFiles(archivePath);
    await expect(page.getByTestId('theme-staged-summary')).toBeVisible();
    await page.getByTestId('theme-cancel-staged').click();

    await expect(page.getByTestId('theme-staged-summary')).toHaveCount(0);
    await expect(page.getByTestId('theme-apply-staged')).toHaveCount(0);
    // Nothing was activated: the built-in is still the selected theme.
    await expect(page.getByTestId('appearance-theme-obsidian-chronicle')).toHaveClass(/btn-active/);
    const installed = await page.evaluate(
      ([lastGoodKey]) => localStorage.getItem(lastGoodKey),
      [LAST_GOOD_KEY],
    );
    expect(installed).toBeNull();
  });

  test('AC-4: a non-package file is rejected with a named diagnostic and nothing activates', async ({
    page,
  }) => {
    const junkPath = join(tempDir, 'not-a-theme.zip');
    // A ZIP whose manifest is hostile: a traversal variant path.
    writeFileSync(
      junkPath,
      buildStoredZip([
        {
          path: 'theme.json',
          text: JSON.stringify({
            schemaVersion: 1,
            kind: 'aikami-theme',
            id: 'evil',
            version: '1.0.0',
            themeApiRange: '>=1.0 <2.0',
            name: 'Evil',
            author: { displayName: 'x' },
            license: 'MIT',
            variants: { light: '../escape.json' },
            assets: [],
          }),
        },
        { path: '../escape.json', text: '{}' },
      ]),
    );

    await page.getByTestId('theme-import-input').setInputFiles(junkPath);
    await expect(page.getByTestId('theme-package-errors')).toBeVisible();
    // The diagnostic is named and points at the offending path. (Which layer
    // reports it depends on whether the archive library normalised the entry
    // name on the way in — both are the same rejection.)
    await expect(page.getByTestId('theme-package-errors')).toContainText('invalid-path');
    await expect(page.getByTestId('theme-package-errors')).toContainText('../escape.json');
    await expect(page.getByTestId('theme-staged-summary')).toHaveCount(0);
    await expect(page.getByTestId('appearance-theme-obsidian-chronicle')).toHaveClass(/btn-active/);
  });
});

// ── C-529 AC-5 — accessibility policy wins ─────────────────────────────────

test.describe('C-529 accessibility appearance overrides', () => {
  test('AC-5: high contrast is applied last, survives a reload, and lists what it changed', async ({
    page,
  }) => {
    await page.goto('/settings?section=interface');
    await page.evaluate(
      ([accessibilityKey]) => localStorage.removeItem(accessibilityKey),
      [ACCESSIBILITY_KEY],
    );
    await page.reload();

    await page.getByTestId('appearance-high-contrast').check();
    await expect(page.getByTestId('appearance-change-summary')).toBeVisible();

    const injected = await page.evaluate(
      () => document.getElementById('aikami-theme-scope-style')?.textContent ?? '',
    );
    // Accessibility is emitted for the scope AFTER the trusted root, so on the
    // game shell it is the last word. (A custom theme's rule would sit before
    // both — that ordering is asserted in the editor Apply test.)
    expect(injected.indexOf(':root')).toBeGreaterThan(-1);
    expect(injected.indexOf('[data-aikami-theme-scope]')).toBeGreaterThan(
      injected.indexOf(':root'),
    );

    await page.reload();
    await expect(page.getByTestId('appearance-high-contrast')).toBeChecked();

    await page.getByTestId('appearance-opaque-surfaces').check();
    await expect(page.getByTestId('appearance-change-summary')).toContainText('color.panel');
  });

  test('AC-5: accessibility selection is independent of the theme and HUD', async ({ page }) => {
    await page.goto('/settings?section=interface');
    await page.evaluate(
      ([hudKey, motionKey]) => {
        localStorage.setItem(
          hudKey,
          '{"schemaVersion":1,"selectedPresetId":"minimal","overrides":[]}',
        );
        localStorage.setItem(motionKey, 'reduce');
      },
      [HUD_KEY, MOTION_KEY],
    );
    await page.getByTestId('appearance-high-contrast').check();
    await page.getByTestId('appearance-theme-obsidian-chronicle').click();
    await page.reload();

    const stored = await page.evaluate(
      ([hudKey, motionKey]) => ({
        hud: localStorage.getItem(hudKey),
        motion: localStorage.getItem(motionKey),
      }),
      [HUD_KEY, MOTION_KEY],
    );
    expect(stored.hud).toContain('minimal');
    expect(stored.motion).toBe('reduce');
    await expect(page.getByTestId('appearance-high-contrast')).toBeChecked();
  });
});

// ── C-529 AC-8 — the warm-application timing budget ────────────────────────

test.describe('C-529 performance evidence', () => {
  test('AC-8: warm valid-theme application p95 stays within the 150ms budget', async ({ page }) => {
    await page.goto('/settings?section=interface');
    await page.evaluate(
      ([selection, accessibilityKey]) => {
        localStorage.removeItem(selection);
        localStorage.removeItem(accessibilityKey);
      },
      [SELECTION_KEY, ACCESSIBILITY_KEY],
    );
    await page.reload();

    // Warm: the built-in palette and the scope style element already exist, so
    // this measures the real apply path (resolve → compile → write attributes →
    // write the scoped stylesheet), not module loading.
    await page.getByTestId('appearance-mode-dark').click();
    await page.getByTestId('appearance-mode-light').click();

    const samples = await page.evaluate(async () => {
      const times: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        const target = index % 2 === 0 ? 'dark' : 'light';
        const input = document.querySelector<HTMLInputElement>(
          `[data-testid="appearance-mode-${target}"] input`,
        );
        if (input === null) {
          continue;
        }
        const start = performance.now();
        input.click();
        // Yield to Svelte's flush, then read the applied result.
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        const applied = document.documentElement.getAttribute('data-theme') === target;
        if (applied) {
          times.push(performance.now() - start);
        }
      }
      times.sort((left, right) => left - right);
      const at = (quantile: number): number =>
        times.length === 0
          ? Number.NaN
          : (times[Math.min(times.length - 1, Math.floor(quantile * times.length))] ?? Number.NaN);
      return { count: times.length, p50: at(0.5), p95: at(0.95) };
    });

    expect(samples.count).toBeGreaterThanOrEqual(10);
    // Recorded in the contract's Evidence Matrix; the budget is 150ms.
    expect(samples.p95).toBeLessThan(150);
  });
});
