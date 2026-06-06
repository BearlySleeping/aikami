// scripts/src/lib/ops/validate_lpc_visuals.ts
// LPC Visual Validation — sends Playwright screenshots to Gemini for AI grading.
//
// Usage: bun run scripts/src/lib/ops/validate_lpc_visuals.ts
//
// Scans test-results/lpc-visual/ for PNG screenshots captured by the
// Playwright lpc_visual test suite. Each image is sent to Gemini with a
// detailed prompt about 2D RPG sprite correctness (layer alignment,
// clipping, color tinting, Z-ordering). Outputs a consolidated JSON
// report to stdout and test-results/lpc-visual/report.json.
//
// Prerequisites:
//   1. GEMINI_API_KEY environment variable must be set.
//   2. Playwright lpc_visual.spec.ts must have been run first to
//      generate screenshots in test-results/lpc-visual/.

// biome-ignore-all lint/style/useNamingConvention: matches contract C-050 JSON output format

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY environment variable is not set.');
  process.exit(1);
}

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

/** Directory containing Playwright LPC screenshots. */
const SCREENSHOT_DIR = resolve(join('test-results', 'lpc-visual'));

/** Minimum confidence score for a passing configuration (0-100). */
const PASSING_SCORE = 70;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single screenshot to evaluate. */
type LpcScreenshotEntry = {
  /** Absolute path to the PNG file. */
  path: string;
  /** Base filename without extension (used as config_id). */
  name: string;
};

/** AI evaluation result for a single screenshot. */
type LpcVisualResult = {
  config_id: string;
  score: number;
  is_acceptable: boolean;
  issues_detected: string[];
};

/** Consolidated report written to report.json. */
type LpcVisualReport = {
  generated_at: string;
  total_configs: number;
  acceptable_count: number;
  unacceptable_count: number;
  average_score: number;
  results: LpcVisualResult[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Finds all PNG screenshots in the LPC visual test output directory.
 *
 * @returns Array of screenshot entries sorted by filename.
 */
const findScreenshots = (): LpcScreenshotEntry[] => {
  if (!existsSync(SCREENSHOT_DIR)) {
    console.error(`❌ Screenshot directory not found: ${SCREENSHOT_DIR}`);
    console.error('   Run Playwright lpc_visual.spec.ts first.');
    process.exit(1);
  }

  const entries = readdirSync(SCREENSHOT_DIR, { withFileTypes: true });
  const results: LpcScreenshotEntry[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.png')) {
      results.push({
        path: join(SCREENSHOT_DIR, entry.name),
        name: entry.name.replace('.png', ''),
      });
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return results;
};

/**
 * Converts a PNG screenshot to a base64-encoded data URI.
 *
 * Reads the file directly via Bun and returns a data URI string
 * suitable for the Gemini API inline_data field.
 *
 * @param imagePath - Absolute path to the PNG screenshot.
 * @returns A `data:image/png;base64,...` string.
 */
const imageToBase64DataUri = async (imagePath: string): Promise<string> => {
  const file = Bun.file(imagePath);
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  return `data:image/png;base64,${base64}`;
};

// ---------------------------------------------------------------------------
// Gemini prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the evaluation prompt for Gemini.
 *
 * The prompt instructs the model to check for specific LPC rendering
 * issues: layer alignment, Z-ordering, color tinting, clipping,
 * and overall sprite composition.
 *
 * @param configId - Human-readable config name (from filename).
 * @returns A structured prompt string.
 */
const buildLpcPrompt = (configId: string): string => {
  return `
You are an expert QA Visual Inspector analyzing a screenshot of a 2D RPG
character sprite composed from layered LPC (Liberated Pixel Cup) assets.

Evaluation Target: ${configId}

The character is built by stacking multiple 64×64 grayscale sprite layers
(body, head, hair, torso, legs, feet, weapon) with palette-based color
remapping. Each layer is extracted from a 832×1344 spritesheet grid.

CRITICAL INSTRUCTIONS:
- Look ONLY at the image provided. Do NOT rely on memory.
- The sprite layers should be centered and aligned on top of each other.
  Misaligned layers (e.g., head not on top of body, weapon floating
  away from hand) are REGRESSIONS.
- Layer Z-ordering should follow standard RPG character stacking:
  body → legs → torso → head → hair → feet → weapon (back to front).
  Layers rendered in wrong order (hair behind head, weapon behind body)
  are REGRESSIONS.
- Color tinting: grayscale layers should be palette-remapped. If colors
  are missing (all white/gray), the palette pipeline is BROKEN.
- If a palette color is specified (e.g., bright pink hair, green eyes),
  verify that the color is visibly applied. Wrong tints or washed-out
  colors are REGRESSIONS.
- Check for clipping: no body parts should be cut off at the 64×64
  sprite boundaries. Truncated limbs, heads, or weapons are REGRESSIONS.
- Check for rendering artifacts: missing textures (magenta blocks),
  doubled sprites, or ghosting are REGRESSIONS.
- The background should be dark blue (#0d0d1a). If the canvas is blank
  or solid black, the PixiJS renderer FAILED TO INITIALIZE — score 0.

Give a score from 0 to 100 based on how well the actual sprite matches
expected 2D RPG character rendering quality.

If the score is below ${PASSING_SCORE}, provide SPECIFIC, ACTIONABLE
descriptions of what is visually wrong. Use layer names ('body', 'head',
'hair', 'torso', 'legs', 'feet', 'weapon') when identifying which layer
has the issue.

DO NOT guess. DO NOT write code. DO NOT suggest CSS fixes.
Just describe the visual discrepancy clearly so a game-engine developer
can identify the issue in the PixiJS/bitECS implementation.

Respond with ONLY a JSON object in this exact format (no markdown code blocks):
{
  "score": 85,
  "is_acceptable": true,
  "issues_detected": [
    "[hair] The hair layer is rendering behind the head layer — it should be in front.",
    "[torso] The plate armor tint appears as solid gray instead of metallic silver."
  ]
}
`.trim();
};

// ---------------------------------------------------------------------------
// Gemini API call
// ---------------------------------------------------------------------------

/**
 * Sends a single screenshot to Gemini for evaluation.
 *
 * @param configId - Config name for context in the prompt.
 * @param imageDataUri - Base64-encoded WebP data URI.
 * @returns Parsed evaluation result.
 */
const evaluateScreenshot = async (
  configId: string,
  imageDataUri: string,
): Promise<LpcVisualResult> => {
  const prompt = buildLpcPrompt(configId);

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/png', data: imageDataUri.split(',')[1] } },
        ],
      },
    ],
    generation_config: {
      temperature: 0.1,
      max_output_tokens: 1024,
    },
  };

  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown Error');
    throw new Error(`Gemini API failed (${response.status}): ${errorText}`);
  }

  const jsonResponse = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const rawText: string = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // Extract JSON from response (may be wrapped in markdown code blocks)
  const cleaned = rawText
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error(`Could not parse JSON from Gemini response: ${cleaned.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    config_id: configId,
    score: typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 0,
    is_acceptable: typeof parsed.score === 'number' ? parsed.score >= PASSING_SCORE : false,
    issues_detected: Array.isArray(parsed.issues_detected) ? parsed.issues_detected : [],
  };
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  console.log('🔍 LPC Visual Validation — AI-powered sprite quality grading');
  console.log(`   Model: gemini-2.0-flash`);
  console.log(`   Passing score: ${PASSING_SCORE}/100`);
  console.log('');

  const screenshots = findScreenshots();

  if (screenshots.length === 0) {
    console.log('⚠️  No screenshots found in', SCREENSHOT_DIR);
    console.log('   Run Playwright lpc_visual.spec.ts first.');
    process.exit(0);
  }

  console.log(`📸 Found ${screenshots.length} screenshots to evaluate:\n`);
  for (const entry of screenshots) {
    console.log(`   - ${entry.name}`);
  }
  console.log('');

  const results: LpcVisualResult[] = [];

  for (let i = 0; i < screenshots.length; i++) {
    const entry = screenshots[i];
    if (!entry) {
      continue;
    }

    const progress = `[${i + 1}/${screenshots.length}]`;
    console.log(`${progress} Evaluating: ${entry.name}...`);

    try {
      const dataUri = await imageToBase64DataUri(entry.path);
      const result = await evaluateScreenshot(entry.name, dataUri);

      const statusIcon = result.is_acceptable ? '✅' : '❌';
      console.log(`   ${statusIcon} Score: ${result.score}/100`);

      if (result.issues_detected.length > 0) {
        for (const issue of result.issues_detected) {
          console.log(`      • ${issue}`);
        }
      }

      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Evaluation failed: ${message}`);

      results.push({
        config_id: entry.name,
        score: 0,
        is_acceptable: false,
        issues_detected: [`Evaluation error: ${message}`],
      });
    }

    console.log('');
  }

  // Build consolidated report
  const acceptableCount = results.filter((r) => r.is_acceptable).length;
  const totalScore = results.reduce((sum, r) => sum + r.score, 0);

  const report: LpcVisualReport = {
    generated_at: new Date().toISOString(),
    total_configs: results.length,
    acceptable_count: acceptableCount,
    unacceptable_count: results.length - acceptableCount,
    average_score: results.length > 0 ? Math.round(totalScore / results.length) : 0,
    results,
  };

  // Write report file
  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const reportPath = join(SCREENSHOT_DIR, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('═══════════════════════════════════════════');
  console.log('📊 Consolidated Report');
  console.log('═══════════════════════════════════════════');
  console.log(`   Total configs:     ${report.total_configs}`);
  console.log(`   Acceptable:        ${report.acceptable_count}`);
  console.log(`   Unacceptable:      ${report.unacceptable_count}`);
  console.log(`   Average score:     ${report.average_score}/100`);
  console.log(`   Report written to: ${reportPath}`);
  console.log('');

  if (report.unacceptable_count > 0) {
    console.log('❌ Some configurations failed validation. See report for details.');
    process.exit(1);
  }

  console.log('✅ All configurations passed validation.');
  process.exit(0);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ Fatal error:', message);
  process.exit(1);
});
