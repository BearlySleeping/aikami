// apps/e2e/src/visual/suites/creator_studio.visual.ts
//
// C-512 AC-1 / AC-4: visual checks for the Creator Studio library.
//
// The engine is stubbed at the C-510 sd-server transport boundary so the suite
// renders a deterministic saved asset: the library grid must show the tag, its
// provenance chip and its size.
//
// Contract: C-512 Creator Studio and Runtime Asset Generation

import { CreatorStudioSchema } from '@aikami/schemas';
import { defineConfig } from '$visual/core/config';

/** A 1×1 transparent PNG — a valid payload for the stubbed engine. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const STUB_MODEL_ID = 'sd_xl_base_1.0';

export default defineConfig({
  id: 'creator_studio',
  route: '/studio/assets',
  waitCondition: 'pixi_loaded',
  requiresAuth: false,
  cases: [
    {
      name: 'Studio with a saved asset in the library',
      searchParams: {},
      prompt: `Evaluate the Creator Studio page. It should show:
1. A "Creator Studio" heading and a short explanatory line
2. An "Asset type" select and a "Prompt" textarea
3. A "Generate" button
4. A "My library" section
5. At least one library entry showing its registry tag, a provenance chip reading
   "generated:sdcpp", a file size, and Rename/Delete buttons
6. Clean spacing, readable labels, no overlapping or clipped controls`,
      schema: CreatorStudioSchema,
      setupHook: async (page) => {
        // The C-510 sd-server transport: readiness probe, model list, and
        // inline generation. Stubbing the legacy /sdapi/v1/txt2img instead
        // would leave generation hanging on the poll deadline.
        await page.route('**/sdapi/v1/sd-models', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{ title: STUB_MODEL_ID, model_name: STUB_MODEL_ID }]),
          }),
        );
        await page.route('**/sdcpp/v1/img_gen', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ images: [`data:image/png;base64,${PNG_BASE64}`] }),
          }),
        );
        await page.route('**/sdcpp/v1/jobs/**', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              state: 'completed',
              images: [`data:image/png;base64,${PNG_BASE64}`],
            }),
          }),
        );

        await page.locator('#studio-prompt').fill('Rusty iron gate');
        await page.getByRole('button', { name: 'Generate', exact: true }).click();
        await page.getByRole('button', { name: 'Save to library' }).click();
        await page.getByText(/Saved "props:rusty-iron-gate"/).waitFor({ timeout: 30_000 });
      },
    },
  ],
});
