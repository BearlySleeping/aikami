// apps/e2e/src/visual/suites/image_gen.visual.ts
// Image Generation Pipeline — declarative visual test suite.
//
// Captures the /dev/image-gen sandbox page to verify style profile editor,
// prompt compiler output, contextual trigger simulator, and gallery panel.
//
// Contract: C-242

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const ImageGenSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  profileEditorVisible: Type.Boolean({
    description: 'Whether the style profile editor with dropdown and profile card is visible',
  }),
  compilerTabAccessible: Type.Boolean({
    description: 'Whether the Compiler tab can be seen with prompt textarea',
  }),
  galleryTabAccessible: Type.Boolean({
    description: 'Whether the Gallery tab shows the add-mock button',
  }),
  darkThemeApplied: Type.Boolean({
    description: 'Whether the page uses a dark theme with semantic colors',
  }),
  tabsRendered: Type.Boolean({
    description: 'Whether the 4 tab bar items are visible',
  }),
});

// ── Suite ─────────────────────────────────────────────────────

export default defineConfig({
  id: 'image-gen',
  route: '/dev/image-gen',
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'Profiles tab — default state',
      prompt: `Evaluate the Image Generation Pipeline sandbox at /dev/image-gen. 
The page should show:
1. Title "Image Gen Pipeline" at the top
2. A tab bar with 4 items: PROFILES, COMPILER, TRIGGERS, GALLERY
3. The Profiles tab should be active (highlighted)
4. An "Active Profile" dropdown showing "Auto 🔒"
5. A profile info card below showing the Auto profile details
6. A "📋 Clone" button in the card
7. Dark theme (dark background, light text)`,
      schema: ImageGenSchema,
      clipSize: 600,
    },
    {
      name: 'Compiler tab — prompt compilation',
      searchParams: {},
      prompt: `Evaluate the Compiler tab of the Image Gen Pipeline sandbox.
After clicking the "Compiler" tab:
1. The tab should be active/highlighted
2. An "Active Profile" label showing the current profile name
3. A "Base Prompt" textarea
4. An "Image Type" dropdown
5. A "🧪 Compile Prompt" button
6. Dark theme`,
      schema: Type.Object({
        score: Type.Number({ description: '0-100 score' }),
        compilerTabActive: Type.Boolean(),
        darkThemeApplied: Type.Boolean(),
      }),
      setupHook: async (page) => {
        await page.waitForSelector('.tab', { timeout: 5000 });
        const tabs = page.locator('.tab');
        const count = await tabs.count();
        for (let i = 0; i < count; i++) {
          const text = await tabs.nth(i).textContent();
          if (text?.trim() === 'COMPILER') {
            await tabs.nth(i).click();
            break;
          }
        }
        await page.waitForTimeout(500);
      },
      clipSize: 600,
    },
    {
      name: 'Gallery tab — with mock images',
      prompt: `Evaluate the Gallery tab of the Image Gen Pipeline sandbox.
After adding mock images:
1. A masonry grid (CSS columns) of images should be visible
2. Each image should show a truncated prompt label and image type badge
3. Dark theme`,
      schema: Type.Object({
        score: Type.Number({ description: '0-100 score' }),
        galleryImagesVisible: Type.Boolean(),
        darkThemeApplied: Type.Boolean(),
      }),
      setupHook: async (page) => {
        // Navigate to Gallery tab
        await page.waitForSelector('.tab', { timeout: 5000 });
        const tabs = page.locator('.tab');
        const count = await tabs.count();
        for (let i = 0; i < count; i++) {
          const text = await tabs.nth(i).textContent();
          if (text?.trim() === 'GALLERY') {
            await tabs.nth(i).click();
            break;
          }
        }
        await page.waitForTimeout(300);

        // Add a mock image
        const addBtn = page.getByRole('button', { name: '➕ Add Mock' });
        if (await addBtn.isVisible()) {
          await addBtn.click();
          await page.waitForTimeout(500);
        }
      },
      clipSize: 600,
    },
  ],
});
