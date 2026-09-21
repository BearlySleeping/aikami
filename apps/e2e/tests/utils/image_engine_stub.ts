// apps/e2e/tests/utils/image_engine_stub.ts
//
// C-512: the sd-server transport stub shared by the Creator Studio specs.
//
// The C-510 transport (not the legacy A1111 one) is:
//   GET  /sdapi/v1/sd-models   → readiness probe + model verification
//   POST /sdcpp/v1/img_gen     → generation; the image comes back inline
//   GET  /sdcpp/v1/jobs/{id}   → job polling (only when a job id is returned)
//
// Stubbing only `/sdapi/v1/txt2img` (the A1111 endpoint) leaves generation
// hanging on the poll deadline — the stub must answer the real endpoints.

import type { Page } from '@playwright/test';

/** A 1×1 transparent PNG — a valid payload for the stubbed engine. */
export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** The model the stubbed engine advertises (and therefore accepts). */
export const STUB_MODEL_ID = 'sd_xl_base_1.0';

/**
 * Installs a healthy sd-server at the transport boundary.
 *
 * @param page — The Playwright page.
 * @param options.images — Image payloads returned per generation (cycled).
 */
export const stubImageEngine = async (
  page: Page,
  options: { images?: readonly string[] } = {},
): Promise<void> => {
  const images = options.images ?? [`data:image/png;base64,${PNG_BASE64}`];
  let generationCount = 0;

  await page.route('**/sdapi/v1/sd-models', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ title: STUB_MODEL_ID, model_name: STUB_MODEL_ID }]),
    }),
  );

  await page.route('**/sdcpp/v1/img_gen', (route) => {
    const image = images[generationCount % images.length] ?? images[0];
    generationCount += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      // No job id — the transport treats the payload as an inline result.
      body: JSON.stringify({ images: [image], width: 512, height: 512 }),
    });
  });

  // Any polled job is already complete (belt and braces for engine builds that
  // return a job id).
  await page.route('**/sdcpp/v1/jobs/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: 'completed', images: [images[0]], width: 512, height: 512 }),
    }),
  );
};

/** Aborts every engine endpoint so auto-detection finds no engine. */
export const stubNoImageEngine = async (page: Page): Promise<void> => {
  await page.route('**/sdapi/v1/**', (route) => route.abort());
  await page.route('**/sdcpp/v1/**', (route) => route.abort());
  await page.route('**/system_stats', (route) => route.abort());
  await page.route('**/object_info/**', (route) => route.abort());
};
