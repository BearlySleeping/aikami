// .pi/extensions/vision_guard.ts
//
// Vision Guard — makes image handling seamless regardless of the active
// model's vision capability:
//
//   1. Blocks `read` calls on image files when the active model has no
//      native image input (e.g. deepseek-v4-pro), redirecting the LLM to
//      ai_describe_image / ai_validate_image. This prevents the wasted
//      read → "[image omitted]" → fallback round trip.
//
//   2. Enriches `browser_screenshot` results:
//      - Non-vision models: appends an inline VLM description so the
//        follow-up ai_describe_image call is unnecessary.
//      - Vision models: attaches the optimised PNG as image content so
//        the model sees the screenshot directly.

import { existsSync, readFileSync } from 'node:fs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describeImage, toBase64DataUri } from '../../scripts/src/lib/ai';

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|bmp)$/i;

/** Returns true when the given pi context's active model accepts image input. */
const _modelSupportsImages = (ctx: unknown): boolean => {
  const model = (ctx as { model?: { input?: string[] } } | undefined)?.model;
  // Unknown model shape → assume vision-capable (native read handles it).
  if (!model?.input) {
    return true;
  }
  return model.input.includes('image');
};

/** Extracts the saved screenshot filepath from browser_screenshot details. */
const _screenshotPath = (details: unknown): string | undefined => {
  const d = details as { success?: boolean; filepath?: string } | undefined;
  if (d?.success !== true || typeof d.filepath !== 'string') {
    return undefined;
  }
  return existsSync(d.filepath) ? d.filepath : undefined;
};

export default function (pi: ExtensionAPI) {
  // ── 1. Block native image reads on non-vision models ────────
  pi.on('tool_call', (event, ctx) => {
    if (event.toolName !== 'read') {
      return undefined;
    }

    const input = event.input as { path?: string } | undefined;
    const filePath = input?.path;
    if (!filePath || !IMAGE_EXTENSION_PATTERN.test(filePath)) {
      return undefined;
    }

    if (_modelSupportsImages(ctx)) {
      return undefined;
    }

    return {
      block: true,
      reason:
        `The current model does not support image input. Do NOT read image files directly. ` +
        `Use ai_describe_image (imagePath: "${filePath}") for a description, or ` +
        `ai_validate_image for visual QA against an expectation.`,
    };
  });

  // ── 2. Enrich browser_screenshot results ────────────────────
  pi.on('tool_result', async (event, ctx) => {
    if (event.toolName !== 'browser_screenshot' || event.isError) {
      return undefined;
    }

    const filepath = _screenshotPath(event.details);
    if (!filepath) {
      return undefined;
    }

    // Vision-capable model → attach the PNG inline so no read is needed.
    if (_modelSupportsImages(ctx)) {
      try {
        const data = readFileSync(filepath).toString('base64');
        return {
          content: [...event.content, { type: 'image', data, mimeType: 'image/png' }],
        };
      } catch {
        return undefined;
      }
    }

    // Non-vision model → append an inline VLM description.
    try {
      const dataUri = toBase64DataUri(filepath);
      const result = await describeImage({
        imageDataUri: dataUri,
        prompt:
          'Describe this app screenshot concisely: layout, visible text, UI elements, colors, and any errors or empty states.',
      });

      if (result.error || !result.description) {
        return undefined;
      }

      return {
        content: [
          ...event.content,
          {
            type: 'text',
            text:
              `🔍 AI description (current model cannot view images natively):\n` +
              result.description,
          },
        ],
      };
    } catch {
      return undefined;
    }
  });
}
