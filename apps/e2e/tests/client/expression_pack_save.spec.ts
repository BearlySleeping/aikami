// apps/e2e/tests/client/expression_pack_save.spec.ts
//
// C-512 AC-3: an expression pack persists under the resolver tags.
//
// Given a reference face and the expression generator, generating a pack must
// register every emotion under `expressionAssetTag({ npcId, emotion })` — the
// tag `resolveNpcAvatarUrl` / the C-510 expression resolver looks up — and the
// pack must survive a reload.
//
// Contract: C-512 Creator Studio and Runtime Asset Generation

import { expect, test } from '@playwright/test';
import { PNG_BASE64, stubImageEngine } from '$utils/image_engine_stub';

/** Every emotion the pack covers, in the order the studio generates them. */
const PACK_EMOTIONS = ['neutral', 'happy', 'sad', 'angry'] as const;

const NPC_ID = 'merchant';

test.describe('Expression pack save (C-512 AC-3)', () => {
  test('AC-3: each emotion is registered under its resolver tag and survives a reload', async ({
    page,
  }) => {
    // Every generation returns the same valid PNG — the four rows differ by
    // tag, which is what AC-3 asserts (a shared blob is legitimate).
    await stubImageEngine(page);
    await page.goto('/studio/assets');
    await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible({
      timeout: 15_000,
    });

    // NPC-bound draft: the expression recipe + the NPC the pack belongs to.
    await page.locator('#studio-recipe').selectOption('expression');
    await page.locator('#studio-npc').fill(NPC_ID);
    await page.locator('#studio-prompt').fill('Mara the merchant, warm');

    // AC-3's Given clause: a reference face. The studio passes it to every
    // generation in the pack so the set stays consistent.
    await page.locator('#studio-reference').setInputFiles({
      name: 'mara-face.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_BASE64, 'base64'),
    });
    await expect(page.getByText('mara-face.png')).toBeVisible();

    // The pack previews the exact tag each emotion will be saved under.
    for (const emotion of PACK_EMOTIONS) {
      await expect(page.getByText(`portraits:${NPC_ID}-${emotion}`)).toBeVisible();
    }

    // The library section is scoped: the pack preview lists the same tags.
    const library = page.locator('section', { hasText: 'My library' });

    await page.getByRole('button', { name: 'Generate pack' }).click();

    // Every emotion is saved under its resolver tag.
    await expect(page.getByText(`Pack for "${NPC_ID}": 4/4 emotions saved.`)).toBeVisible({
      timeout: 60_000,
    });

    // AC-3 Then-clause: each emotion is a library row under the resolver tag.
    for (const emotion of PACK_EMOTIONS) {
      await expect(
        library.locator('li', { hasText: `portraits:${NPC_ID}-${emotion}` }),
      ).toBeVisible();
    }

    // And the pack is durable — the same tags after a reload.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible({
      timeout: 15_000,
    });
    for (const emotion of PACK_EMOTIONS) {
      await expect(
        library.locator('li', { hasText: `portraits:${NPC_ID}-${emotion}` }),
      ).toBeVisible({ timeout: 20_000 });
    }
  });
});
