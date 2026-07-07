// .pi/extensions/ai_vision_tools.ts
//
// AI Vision Tools — two Pi tools for image analysis via the shared VLM client:
//   ai_describe_image   — free-form description of an image
//   ai_validate_image   — score + review against an expectation
//
// Uses the shared @aikami/utils VLM client (ai_vlm_client.ts) for provider
// routing, caching, JSON extraction, and image optimisation. Respects
// VLM_PROVIDER, VLM_MODEL, and OPENROUTER_API_KEY env vars.
//
// For models that don't support native vision (per isVisionCapable registry),
// the image is embedded as base64 in the text prompt as a degraded fallback.

import { existsSync } from 'node:fs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  describeImage,
  evaluateImage,
  optimizeImage,
  toBase64DataUri,
} from '../../scripts/src/lib/ai';

// ── Shared helpers ────────────────────────────────────────────

/** Resolves and validates an image path, returning the absolute path. */
const _resolveImagePath = (imagePath: string): string => {
  return imagePath.startsWith('/') ? imagePath : `${process.cwd()}/${imagePath}`;
};

/** Optimises and base64-encodes an image at the given path. */
const _prepareImage = async (filepath: string): Promise<string> => {
  await optimizeImage({ filepath });
  return toBase64DataUri(filepath);
};

// ── Validate schema ───────────────────────────────────────────

const VALIDATE_SCHEMA = {
  type: 'object',
  properties: {
    score: {
      type: 'number',
      description: '0-100 score of how well the image matches the expectation',
    },
    review: {
      type: 'string',
      description: 'Detailed review explaining what matches and what does not',
    },
    issues: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of specific visual issues or discrepancies detected',
    },
    expectationMet: {
      type: 'boolean',
      description: 'Whether the expectation is fully met (score >= 80 implies true)',
    },
  },
  required: ['score', 'review', 'issues', 'expectationMet'],
  additionalProperties: false,
} as const;

// ── Extension ────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── ai_describe_image ───────────────────────────────────────
  pi.registerTool({
    name: 'ai_describe_image',
    label: 'AI: Describe Image',
    description:
      'Send a screenshot or image to the configured VLM provider and get ' +
      'back a plain-text description of what is visible. Uses the shared ' +
      'VLM client — respects VLM_PROVIDER, VLM_MODEL, and OPENROUTER_API_KEY ' +
      'environment variables. Optimises the image before sending.',
    promptSnippet: 'Use ai_describe_image to get an AI description of a screenshot or image.',
    promptGuidelines: [
      'Use when you need to understand what is visible in an image without looking at it yourself.',
      'Useful for batch screenshot analysis, visual QA, or when the model does not support image attachments.',
      'Pass a prompt to focus the description on specific aspects (layout, color, text, etc.).',
      'The image is automatically optimised (Lanczos resize + PNG8) before sending.',
    ],
    parameters: Type.Object({
      imagePath: Type.String({
        description: 'Absolute or relative path to the image file (PNG or WebP).',
      }),
      prompt: Type.Optional(
        Type.String({
          description:
            'Optional prompt to guide the description. E.g. "Describe the layout and UI elements". Defaults to a generic description prompt.',
        }),
      ),
      model: Type.Optional(
        Type.String({
          description:
            'Override the VLM model slug. Defaults to VLM_MODEL env var or google/gemini-2.5-flash.',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { imagePath, prompt, model } = params;
      const resolvedPath = _resolveImagePath(imagePath);

      if (!existsSync(resolvedPath)) {
        return {
          content: [{ type: 'text', text: `❌ Image not found: ${resolvedPath}` }],
          details: { success: false },
        };
      }

      try {
        const dataUri = await _prepareImage(resolvedPath);

        const descriptionPrompt =
          prompt ??
          'Describe this image in detail. Include layout, colors, visible text, UI elements, and any notable visual features. Be specific and thorough.';

        const result = await describeImage({
          imageDataUri: dataUri,
          prompt: descriptionPrompt,
          model,
        });

        if (result.error) {
          return {
            content: [{ type: 'text', text: `❌ AI description failed: ${result.error}` }],
            details: { success: false, error: result.error },
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `🖼️  AI Image Description\n\n${result.description}`,
            },
          ],
          details: { success: true, description: result.description },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `❌ Error describing image: ${message}` }],
          details: { success: false, error: message },
        };
      }
    },
  });

  // ── ai_validate_image ──────────────────────────────────────
  pi.registerTool({
    name: 'ai_validate_image',
    label: 'AI: Validate Image',
    description:
      'Send a screenshot to the configured VLM with an expectation description ' +
      'and get back a score (0-100) plus a review explaining what matches and ' +
      'what does not. Uses the shared VLM client — respects VLM_PROVIDER, ' +
      'VLM_MODEL, and OPENROUTER_API_KEY env vars.',
    promptSnippet: 'Use ai_validate_image to check if a screenshot matches expected visual output.',
    promptGuidelines: [
      'Use for visual QA — give a clear expectation of what the image should show.',
      'Example expectation: "The login page should have a centered form with email field, password field, and a blue Sign In button."',
      'The tool returns a score (0-100), a detailed review, and a list of specific issues.',
      'Score >= 80 means the expectation is considered met.',
      'The image is automatically optimised before sending.',
      'Results are cached — re-running with the same image + expectation uses the cached result.',
    ],
    parameters: Type.Object({
      imagePath: Type.String({
        description: 'Absolute or relative path to the image file (PNG or WebP).',
      }),
      expectation: Type.String({
        description:
          'What you expect to see in the image. Be specific about layout, colors, text, UI elements, and visual state. E.g. "The home page should show a dark navbar with the Aikami logo on the left, a search bar in the center, and a user avatar on the right. Below the navbar, there should be a grid of 3 feature cards."',
      }),
      model: Type.Optional(
        Type.String({
          description:
            'Override the VLM model slug. Defaults to VLM_MODEL env var or google/gemini-2.5-flash.',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { imagePath, expectation, model } = params;
      const resolvedPath = _resolveImagePath(imagePath);

      if (!existsSync(resolvedPath)) {
        return {
          content: [{ type: 'text', text: `❌ Image not found: ${resolvedPath}` }],
          details: { success: false },
        };
      }

      try {
        const dataUri = await _prepareImage(resolvedPath);

        const prompt = [
          'You are an expert QA Visual Inspector. Evaluate whether the provided screenshot',
          'matches the expected description below.',
          '',
          'EXPECTATION:',
          expectation,
          '',
          'Carefully examine the image and compare it against the expectation.',
          'Check layout, colors, text content, UI element positions, visual state,',
          'and overall appearance.',
          '',
          'Return ONLY a JSON object with:',
          '- score: number 0-100 (100 = perfectly matches expectation)',
          '- review: string (detailed feedback explaining what matches and what does not)',
          '- issues: string[] (specific visual discrepancies, empty if none)',
          '- expectationMet: boolean (true if score >= 80)',
          '',
          'Be precise and actionable in your review. Reference specific elements',
          'by their visual appearance, position, or text content.',
        ].join('\n');

        const result = await evaluateImage<{
          score: number;
          review: string;
          issues: string[];
          expectationMet: boolean;
        }>({
          imageDataUri: dataUri,
          prompt,
          schema: VALIDATE_SCHEMA,
          model,
        });

        if (result.error) {
          return {
            content: [{ type: 'text', text: `❌ AI validation failed: ${result.error}` }],
            details: { success: false, error: result.error },
          };
        }

        const data = result.result;
        if (!data) {
          return {
            content: [{ type: 'text', text: '❌ AI validation failed: no result data' }],
            details: { success: false, error: 'no result data' },
          };
        }
        const score = data.score ?? 0;
        const passed = score >= 80;
        const icon = passed ? '✅' : '❌';
        const fromCache = result.fromCache ? ' (cached)' : '';

        const issuesList =
          data.issues && data.issues.length > 0
            ? data.issues.map((i: string) => `  • ${i}`).join('\n')
            : '  (no specific issues detected)';

        const output = [
          `${icon} Visual Validation Result${fromCache}`,
          `   Score: ${score}/100 (${passed ? 'PASS' : 'FAIL'})`,
          '',
          '── Review ──',
          data.review ?? '(no review provided)',
          '',
          '── Issues ──',
          issuesList,
        ].join('\n');

        return {
          content: [{ type: 'text', text: output }],
          details: {
            success: true,
            score,
            passed,
            review: data.review,
            issues: data.issues,
            fromCache: result.fromCache,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `❌ Error validating image: ${message}` }],
          details: { success: false, error: message },
        };
      }
    },
  });
}
