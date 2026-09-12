// apps/e2e/tests/hub/map_studio.spec.ts
//
// C-507 (visual editor) + C-508 (drafts + community publishing).
//
// The UI tests run against the local hub dev server (catalog loaded from
// CATALOG_ORIGIN_URL). The API test is D1-backed and skips itself when the
// hub runs without bindings (`vite dev`), matching the catalog spec's
// signed-in skip behavior; CI's `dev:worker` has real local D1/R2.

import { SCENE_DOCUMENT_KIND, SCENE_SCHEMA_VERSION } from '@aikami/constants';
import { expect, test } from '@playwright/test';

/** A schema-valid native scene the API test can publish. */
const sceneDocument = (id: string): string =>
  JSON.stringify({
    kind: SCENE_DOCUMENT_KIND,
    schemaVersion: SCENE_SCHEMA_VERSION,
    id,
    assetLock: 'pack:emberwatch',
    extent: { width: 2, height: 2, tileSize: 32 },
    surface: { mode: 'baked', palette: ['', 'grass.png'], grid: [0, 1, 1, 0] },
    layers: [],
    placements: [],
    navigation: {},
  });

test.describe('Map Studio UI — C-507/C-508', () => {
  test('AC-1/AC-6: the studio loads the sample, then enters edit mode', async ({ page }) => {
    await page.goto('/map-studio');

    await expect(page.getByRole('heading', { name: 'Map Studio' })).toBeVisible();
    // The preview badge flips to "live" once the engine renders the sample.
    await expect(page.getByText('live', { exact: true })).toBeVisible({ timeout: 30_000 });
    // The C-508 drafts/publishing panel is present on the public route.
    await expect(page.getByText('Drafts & publish')).toBeVisible();

    // Enter edit mode: the C-507 toolbar becomes available.
    await page.getByTestId('toggle-edit').click();
    await expect(page.getByTestId('tool-select')).toBeVisible();
    await expect(page.getByTestId('tool-paint')).toBeVisible();
    await expect(page.getByTestId('export')).toBeVisible();
  });

  test('AC-2/AC-4/AC-5: paint a cell, undo, and export a native scene', async ({ page }) => {
    await page.goto('/map-studio');
    await page.getByTestId('toggle-edit').click();
    await expect(page.getByTestId('tool-paint')).toBeVisible();

    // Paint a cell — undo must become available (an edit happened). Cell (1,1)
    // starts on a different palette frame than the selected paint frame.
    await page.getByTestId('tool-paint').click();
    await page.getByLabel('Map preview').click({ position: { x: 48, y: 48 } });
    await expect(page.getByTestId('undo')).toBeEnabled();

    // Undo restores the pre-edit state.
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('redo')).toBeEnabled();

    // Export downloads the canonical native scene JSON.
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.scene\.json$/);
  });

  test('AC-2: keyboard users can apply the selected tool', async ({ page }) => {
    await page.goto('/map-studio');
    await page.getByTestId('toggle-edit').click();
    await page.getByTestId('tool-paint').click();

    const canvas = page.getByLabel('Map preview');
    await canvas.focus();
    await canvas.press('ArrowRight');
    await canvas.press('ArrowDown');
    await canvas.press('Enter');

    await expect(page.getByTestId('undo')).toBeEnabled();
  });

  test('C-508: terrain-channel scenes render a frame', async ({ page }) => {
    // A terrain surface only compiles when the page supplied pack terrains +
    // a base terrain (the C-507 gap). Pasting one must not surface the
    // "requires pack terrain definitions" error.
    const terrainScene = JSON.stringify({
      kind: SCENE_DOCUMENT_KIND,
      schemaVersion: SCENE_SCHEMA_VERSION,
      id: 'terrain-e2e',
      assetLock: 'pack:emberwatch',
      extent: { width: 3, height: 2, tileSize: 32 },
      surface: {
        mode: 'terrain',
        defaultTerrain: 'grass',
        cells: ['grass', 'dirt', 'dirt', 'grass', 'grass', 'gravel'],
      },
      layers: [],
      placements: [],
      navigation: {},
    });

    await page.goto('/map-studio');
    await expect(page.getByText('live', { exact: true })).toBeVisible({ timeout: 30_000 });

    const textarea = page.getByLabel('Map manifest JSON');
    await textarea.fill(terrainScene);

    // Dirt occupies cell (1,0). A successful terrain compile paints that cell
    // (from the atlas or the renderer's diagnostic fallback) with nonzero alpha.
    const canvas = page.getByLabel('Map preview');
    await expect
      .poll(() =>
        canvas.evaluate((element) => {
          const context = (element as HTMLCanvasElement).getContext('2d');
          return context?.getImageData(48, 16, 1, 1).data[3] ?? 0;
        }),
      )
      .toBeGreaterThan(0);
  });
});

test.describe('Map Studio API — C-508 (requires D1)', () => {
  test('drafts round-trip and community publishing bumps revisions', async ({
    request,
    baseURL,
  }) => {
    // Skip when the hub has no bindings (local `vite dev`).
    const probe = await request.get('/api/maps/drafts');
    test.skip(probe.status() === 503, 'hub has no D1 bindings in this instance');
    expect(probe.status()).toBe(401);

    const email = `map-studio-e2e-${Date.now()}@example.com`;
    const password = 'password123';
    await request.post('/api/auth/sign-up/email', {
      data: { name: 'Map Studio E2E', email, password },
    });
    const signIn = await request.post('/api/auth/sign-in/email', { data: { email, password } });
    expect(signIn.ok()).toBe(true);
    const cookie = signIn.headers()['set-cookie']?.split(';')[0] ?? '';
    expect(cookie).toContain('=');
    const headers = { cookie };

    // Create → list → get → update → delete.
    const created = await request.post('/api/maps/drafts', {
      headers,
      data: { name: 'E2E draft', document: sceneDocument('e2e-draft') },
    });
    expect(created.status()).toBe(201);
    const draft = (await created.json()) as { id: string };

    const list = await request.get('/api/maps/drafts', { headers });
    expect(list.status()).toBe(200);
    expect(((await list.json()) as Array<{ id: string }>).some((d) => d.id === draft.id)).toBe(
      true,
    );

    const updated = await request.put(`/api/maps/drafts/${draft.id}`, {
      headers,
      data: { name: 'E2E draft (renamed)' },
    });
    expect(updated.status()).toBe(200);

    const removed = await request.delete(`/api/maps/drafts/${draft.id}`, { headers });
    expect(removed.status()).toBe(200);

    // Publish twice: same owner + derived slug → revision 1 then 2.
    const title = `E2E Map ${Date.now()}`;
    const first = await request.post('/api/maps/community', {
      headers,
      data: { title, document: sceneDocument('community-1') },
    });
    expect(first.status()).toBe(201);
    const firstBody = (await first.json()) as { slug: string; revision: number };
    expect(firstBody.revision).toBe(1);

    const second = await request.post('/api/maps/community', {
      headers,
      data: { title, document: sceneDocument('community-2') },
    });
    expect(second.status()).toBe(200);
    expect(((await second.json()) as { revision: number }).revision).toBe(2);

    // Public read-back.
    const fetched = await request.get(`/api/maps/community/${firstBody.slug}`);
    expect(fetched.status()).toBe(200);
    const fetchedBody = (await fetched.json()) as { document: string; revision: number };
    expect(fetchedBody.revision).toBe(2);
    expect(fetchedBody.document).toContain(SCENE_DOCUMENT_KIND);

    // The document gate rejects an invalid submission.
    const invalid = await request.post('/api/maps/community', {
      headers,
      data: { title: 'Bad', document: '{"kind":"nope"}' },
    });
    expect(invalid.status()).toBe(422);

    void baseURL;
  });
});
