// scripts/src/lib/ops/validate_lpc_visuals.ts
// LPC Visual Validation — sends Playwright screenshots to Gemini via OpenRouter for AI grading.
//
// Usage: bun run scripts/src/lib/ops/validate_lpc_visuals.ts [--force]
//
//   --force   Bypass checksum cache, re-evaluate every image via LLM
//
// Scans apps/e2e/test-results/lpc-visual/ for PNG screenshots captured by the
// Playwright lpc_visual test suite. Each image is SHA-256 checksummed — if the
// image hasn't changed since the last run, the cached LLM result is reused
// (saving API cost and time). Use --force to re-evaluate everything.
//
// Scans apps/e2e/test-results/lpc-visual/ for PNG screenshots captured by the
// Playwright lpc_visual test suite. Each image is optimized (resized + WebP) via
// ImageMagick before being sent to Gemini 2.5 Flash (via OpenRouter) with a
// detailed prompt about 2D RPG sprite correctness.
//
// Outputs:
//   report.json  — Consolidated JSON report (VisualFidelityReport schema)
//   index.html   — Human-readable visual report with screenshots and scores
//
// Prerequisites:
//   1. OPENROUTER_API_KEY environment variable must be set.
//   2. Playwright lpc_visual.spec.ts must have been run first.
//   3. ImageMagick 'convert' must be available in PATH.
//
// C-073: VisualFidelityReport schema, OpenRouter API, image optimization, HTML report.

// biome-ignore-all lint/style/useNamingConvention: contract C-050/C-073 JSON output format

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { $ } from 'bun';

// ── Configuration ──────────────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!OPENROUTER_API_KEY?.startsWith('sk-or-v1-')) {
  console.error('❌ OPENROUTER_API_KEY environment variable is missing or invalid.');
  process.exit(1);
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';

/** Directory containing Playwright LPC screenshots (relative to monorepo root). */
const SCREENSHOT_DIR = resolve(join('apps', 'e2e', 'test-results', 'lpc-visual'));

/** Minimum confidence score for a passing configuration (0-100). */
const PASSING_SCORE = 70;

/** ImageMagick optimization: max dimension, WebP quality. */
const MAX_DIMENSION = 800;
const WEBP_QUALITY = 80;

// ── Types ──────────────────────────────────────────────────────────────

type LpcScreenshotEntry = {
  path: string;
  name: string;
};

type LpcVisualResult = {
  recipeId: string;
  componentSlot: string;
  variantAssetId: string;
  /** Original PNG filename without extension (stable cache key). */
  configId: string;
  score: number;
  passed: boolean;
  detectedAnomalies: string[];
  /** SHA-256 of the source PNG at evaluation time. */
  checksum: string;
};

type LpcVisualReport = {
  generated_at: string;
  total_configs: number;
  acceptable_count: number;
  unacceptable_count: number;
  average_score: number;
  results: LpcVisualResult[];
};

// ── Screenshot discovery ───────────────────────────────────────────────

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

// ── Checksum & caching ──────────────────────────────────────────────────

const REPORT_PATH = join(SCREENSHOT_DIR, 'report.json');

/**
 * Compute the SHA-256 digest of a file.
 *
 * Reads the file as a binary buffer and returns a hex string.
 * Used to detect whether a screenshot has changed since last evaluation.
 */
const sha256 = async (filePath: string): Promise<string> => {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  const hash = createHash('sha256');
  hash.update(new Uint8Array(buffer));
  return hash.digest('hex');
};

/**
 * Load cached results from a previous report.json (if it exists).
 *
 * Builds a map: recipeId → { checksum, result } for fast lookup.
 * Results with missing checksum fields are skipped (legacy reports).
 */
const loadCache = (): Map<string, LpcVisualResult> => {
  const cache = new Map<string, LpcVisualResult>();

  if (!existsSync(REPORT_PATH)) {
    return cache;
  }

  try {
    const raw = readFileSync(REPORT_PATH, 'utf-8');
    const prev = JSON.parse(raw) as LpcVisualReport;
    for (const r of prev.results || []) {
      const key = r.configId || r.recipeId;
      if (key && r.checksum) {
        cache.set(key, r);
      }
    }
  } catch {
    // Corrupt or empty report — start fresh
  }

  return cache;
};

// ── Args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const force = args.includes('--force');

// ── Image optimization (ImageMagick) ───────────────────────────────────

/**
 * Optimize a PNG screenshot for API submission using ImageMagick.
 *
 * Resizes to max 800px (maintaining aspect ratio), converts to WebP at 80%
 * quality. Caches the optimized file — skips re-encoding if the source
 * timestamp hasn't changed.
 *
 * @param pngPath - Absolute path to the source PNG.
 * @returns Absolute path to the optimized WebP file.
 */
const optimizeImage = async (pngPath: string): Promise<string> => {
  const webpPath = pngPath.replace(/\.png$/i, '.webp');
  const pngStat = statSync(pngPath);

  // Cache: skip if WebP exists and is newer than PNG
  if (existsSync(webpPath)) {
    const webpStat = statSync(webpPath);
    if (webpStat.mtimeMs >= pngStat.mtimeMs) {
      return webpPath;
    }
  }

  try {
    await $`convert ${pngPath} -resize "${MAX_DIMENSION}x${MAX_DIMENSION}>" -quality ${WEBP_QUALITY} ${webpPath}`.quiet();
  } catch {
    // If ImageMagick fails, fall back to raw PNG
    console.warn(`   ⚠ ImageMagick failed for ${pngPath}, using raw PNG`);
    return pngPath;
  }

  const webpStat = existsSync(webpPath) ? statSync(webpPath) : null;
  const originalKb = Math.round(pngStat.size / 1024);
  const optimizedKb = webpStat ? Math.round(webpStat.size / 1024) : originalKb;
  const savings = originalKb - optimizedKb;

  if (savings > 0) {
    console.log(`   📐 Optimized: ${originalKb}KB → ${optimizedKb}KB (saved ${savings}KB)`);
  }

  return webpPath;
};

/**
 * Read an image file and return a base64 data URI.
 */
const imageToBase64DataUri = async (imagePath: string): Promise<string> => {
  const file = Bun.file(imagePath);
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const ext = imagePath.endsWith('.webp') ? 'webp' : 'png';
  return `data:image/${ext};base64,${base64}`;
};

// ── OpenRouter prompt builder ──────────────────────────────────────────

const buildLpcPrompt = (configId: string): string => {
  const parts = configId.split('-');
  const recipeId = parts[0] ?? configId;
  const componentSlot = parts[1] ?? 'sprite';
  const variantAssetId = parts.slice(2).join('-') || parts.slice(1).join('-') || 'default';

  return `
You are an expert QA Visual Inspector analyzing a screenshot of a 2D RPG
character sprite composed from layered LPC (Liberated Pixel Cup) assets.

Evaluation Target: ${configId}
Recipe ID: ${recipeId}
Component Slot: ${componentSlot}
Variant Asset ID: ${variantAssetId}

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

Respond with ONLY a JSON object in this EXACT schema (no markdown code blocks, no extra text):
{
  "recipeId": "${recipeId}",
  "componentSlot": "${componentSlot}",
  "variantAssetId": "${variantAssetId}",
  "score": 85,
  "passed": true,
  "detectedAnomalies": [
    "[hair] The hair layer is rendering behind the head layer — it should be in front.",
    "[torso] The plate armor tint appears as solid gray instead of metallic silver."
  ]
}
`.trim();
};

// ── OpenRouter API call ────────────────────────────────────────────────

const evaluateScreenshot = async (
  configId: string,
  imageDataUri: string,
): Promise<LpcVisualResult> => {
  const prompt = buildLpcPrompt(configId);

  const requestBody = {
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUri } },
        ],
      },
    ],
  };

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://aikami.dev',
      'X-Title': 'Aikami LPC Visual Validation',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown Error');
    throw new Error(`OpenRouter API failed (${response.status}): ${errorText}`);
  }

  const jsonResponse = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText: string = jsonResponse.choices?.[0]?.message?.content ?? '';

  const cleaned = rawText
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error(`Could not parse JSON from OpenRouter response: ${cleaned.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

  const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 0;
  const passed = typeof parsed.passed === 'boolean' ? parsed.passed : score >= PASSING_SCORE;
  const detectedAnomalies: string[] = Array.isArray(parsed.detectedAnomalies)
    ? (parsed.detectedAnomalies as string[])
    : Array.isArray(parsed.issues_detected)
      ? (parsed.issues_detected as string[])
      : [];

  return {
    recipeId: typeof parsed.recipeId === 'string' ? parsed.recipeId : configId,
    componentSlot: typeof parsed.componentSlot === 'string' ? parsed.componentSlot : 'sprite',
    variantAssetId: typeof parsed.variantAssetId === 'string' ? parsed.variantAssetId : 'default',
    configId,
    score,
    passed,
    detectedAnomalies,
    checksum: '', // filled in by caller after computing file digest
  };
};

// ── HTML report ─────────────────────────────────────────────────────────

/** CSS colour ramp for score bars: red→amber→green. */
const scoreColor = (score: number): string => {
  if (score >= 90) {
    return '#22c55e';
  }
  if (score >= 70) {
    return '#eab308';
  }
  return '#ef4444';
};

const generateHtmlReport = (report: LpcVisualReport, images: Map<string, string>): string => {
  const rows = report.results
    .map((r) => {
      const color = scoreColor(r.score);
      const badge = r.passed
        ? '<span class="badge pass">✅ PASSED</span>'
        : '<span class="badge fail">❌ FAILED</span>';

      const anomalyList =
        r.detectedAnomalies.length > 0
          ? `<ul>${r.detectedAnomalies.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`
          : '<p class="no-issues">No visual discrepancies detected.</p>';

      // Use base64 data URI so images render even when opened from file://
      const imgSrc = images.get(r.configId || r.recipeId) || '';

      return `
      <div class="card">
        <div class="card-header">
          <span class="recipe-id">${escapeHtml(r.configId || r.recipeId)}</span>
          ${badge}
        </div>
        <img src="${imgSrc}" alt="${escapeHtml(r.recipeId)}" loading="lazy" />
        <div class="score-bar">
          <div class="score-fill" style="width:${r.score}%; background:${color}"></div>
          <span class="score-label">${r.score}/100</span>
        </div>
        <div class="anomalies">
          ${anomalyList}
        </div>
      </div>`;
    })
    .join('\n');

  const avgColor = scoreColor(report.average_score);
  const passRate =
    report.total_configs > 0
      ? Math.round((report.acceptable_count / report.total_configs) * 100)
      : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LPC Visual Validation Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0a0a14; color: #e2e8f0;
      font-family: system-ui, -apple-system, sans-serif;
      padding: 2rem;
      min-height: 100vh;
    }
    h1 { color: #38bdf8; font-size: 1.75rem; margin-bottom: 0.5rem; }
    .generated { color: #64748b; font-size: 0.85rem; margin-bottom: 2rem; }
    .summary {
      display: flex; gap: 1.5rem; margin-bottom: 2rem;
      flex-wrap: wrap;
    }
    .stat {
      background: #1e1e2e; border-radius: 8px; padding: 1rem 1.5rem;
      border: 1px solid #2d2d3f; min-width: 120px;
    }
    .stat-label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-value { font-size: 1.5rem; font-weight: 700; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 1.5rem;
    }
    .card {
      background: #12121f; border-radius: 10px;
      border: 1px solid #2d2d3f; overflow: hidden;
    }
    .card-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.75rem 1rem; background: #16162b;
      border-bottom: 1px solid #2d2d3f;
    }
    .recipe-id { font-weight: 600; font-family: monospace; font-size: 0.9rem; color: #cbd5e1; }
    .badge { font-size: 0.8rem; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: 600; }
    .badge.pass { background: #064e3b; color: #6ee7b7; }
    .badge.fail { background: #4c0519; color: #fda4af; }
    .card img {
      width: 100%; display: block;
      image-rendering: pixelated;
      background: #0d0d1a;
    }
    .score-bar {
      position: relative; height: 24px; background: #1e1e2e;
      border-top: 1px solid #2d2d3f; border-bottom: 1px solid #2d2d3f;
    }
    .score-fill {
      height: 100%; transition: width 0.3s ease;
    }
    .score-label {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.8rem; font-weight: 700;
      color: #f8fafc; text-shadow: 0 1px 3px rgba(0,0,0,0.8);
    }
    .anomalies { padding: 0.75rem 1rem; }
    .anomalies ul { list-style: none; }
    .anomalies li {
      font-size: 0.82rem; color: #cbd5e1; line-height: 1.5;
      padding: 0.25rem 0; border-bottom: 1px solid #1e1e2e;
    }
    .anomalies li:last-child { border-bottom: none; }
    .no-issues { color: #22c55e; font-size: 0.85rem; font-style: italic; }
    .avg-score { font-size: 2rem; }
  </style>
</head>
<body>
  <h1>🎴 LPC Visual Validation Report</h1>
  <p class="generated">Generated: ${report.generated_at} · Model: ${MODEL} · Provider: OpenRouter</p>

  <div class="summary">
    <div class="stat">
      <div class="stat-label">Configs</div>
      <div class="stat-value">${report.total_configs}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Avg Score</div>
      <div class="stat-value avg-score" style="color:${avgColor}">${report.average_score}/100</div>
    </div>
    <div class="stat">
      <div class="stat-label">Pass Rate</div>
      <div class="stat-value" style="color:${passRate >= 70 ? '#22c55e' : '#eab308'}">${passRate}%</div>
    </div>
    <div class="stat">
      <div class="stat-label">Passed</div>
      <div class="stat-value" style="color:#22c55e">${report.acceptable_count}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Failed</div>
      <div class="stat-value" style="color:#ef4444">${report.unacceptable_count}</div>
    </div>
  </div>

  <div class="grid">
${rows}
  </div>
</body>
</html>`;
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Main ────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  console.log('🔍 LPC Visual Validation — AI-powered sprite quality grading');
  console.log(`   Provider: OpenRouter`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Passing score: ${PASSING_SCORE}/100`);
  console.log('');

  const screenshots = findScreenshots();

  if (screenshots.length === 0) {
    console.log('⚠️  No screenshots found in', SCREENSHOT_DIR);
    console.log('   Run Playwright lpc_visual.spec.ts first.');
    process.exit(0);
  }

  console.log(`📸 Found ${screenshots.length} screenshot(s) to evaluate:\n`);
  for (const entry of screenshots) {
    console.log(`   • ${entry.name}`);
  }
  console.log('');

  const results: LpcVisualResult[] = [];
  const cache = force ? new Map<string, LpcVisualResult>() : loadCache();
  let cacheHitCount = 0;

  if (force) {
    console.log('🔄 --force: bypassing checksum cache, re-evaluating all images\n');
  } else if (cache.size > 0) {
    console.log(`💾 Loaded ${cache.size} cached result(s) from previous report.json\n`);
  }

  for (let i = 0; i < screenshots.length; i++) {
    const entry = screenshots[i];
    if (!entry) {
      continue;
    }

    const progress = `[${i + 1}/${screenshots.length}]`;

    // Compute checksum before any processing
    const checksum = await sha256(entry.path);

    // Check cache: same recipeId + same checksum → reuse
    const cached = cache.get(entry.name);
    if (cached && cached.checksum === checksum) {
      const icon = cached.passed ? '✅' : '❌';
      console.log(`${progress} ${entry.name} — ♻ cached (checksum ${checksum.slice(0, 8)})`);
      console.log(`   ${icon} Score: ${cached.score}/100`);
      if (cached.detectedAnomalies.length > 0) {
        for (const a of cached.detectedAnomalies) {
          console.log(`      • ${a}`);
        }
      }
      results.push(cached);
      cacheHitCount += 1;
      console.log('');
      continue;
    }

    console.log(`${progress} Evaluating: ${entry.name}...`);

    try {
      // Optimize PNG → WebP before sending to save tokens/bandwidth
      const optimizedPath = await optimizeImage(entry.path);
      const dataUri = await imageToBase64DataUri(optimizedPath);
      const result = await evaluateScreenshot(entry.name, dataUri);

      const statusIcon = result.passed ? '✅' : '❌';
      console.log(`   ${statusIcon} Score: ${result.score}/100`);

      if (result.detectedAnomalies.length > 0) {
        for (const anomaly of result.detectedAnomalies) {
          console.log(`      • ${anomaly}`);
        }
      }

      results.push({ ...result, checksum });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Evaluation failed: ${message}`);

      results.push({
        recipeId: entry.name,
        componentSlot: 'sprite',
        variantAssetId: 'default',
        configId: entry.name,
        score: 0,
        passed: false,
        detectedAnomalies: [`Evaluation error: ${message}`],
        checksum,
      });
    }

    console.log('');
  }

  // Build consolidated report
  const acceptableCount = results.filter((r) => r.passed).length;
  const totalScore = results.reduce((sum, r) => sum + r.score, 0);

  const report: LpcVisualReport = {
    generated_at: new Date().toISOString(),
    total_configs: results.length,
    acceptable_count: acceptableCount,
    unacceptable_count: results.length - acceptableCount,
    average_score: results.length > 0 ? Math.round(totalScore / results.length) : 0,
    results,
  };

  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Build base64 image map from optimized WebP files for self-contained HTML
  const images = new Map<string, string>();
  for (const entry of screenshots) {
    const webpPath = entry.path.replace(/\.png$/i, '.webp');
    const imgPath = existsSync(webpPath) ? webpPath : entry.path;
    images.set(entry.name, await imageToBase64DataUri(imgPath));
  }

  // Write JSON report
  const jsonPath = join(SCREENSHOT_DIR, 'report.json');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  // Write HTML report with embedded base64 images
  const htmlPath = join(SCREENSHOT_DIR, 'index.html');
  writeFileSync(htmlPath, generateHtmlReport(report, images));

  console.log('═══════════════════════════════════════════');
  console.log('📊 Consolidated Report');
  console.log('═══════════════════════════════════════════');
  console.log(`   Total configs:     ${report.total_configs}`);
  if (cacheHitCount > 0) {
    console.log(`   Cache hits:        ${cacheHitCount} (♻ reused)`);
  }
  console.log(`   Acceptable:        ${report.acceptable_count}`);
  console.log(`   Unacceptable:      ${report.unacceptable_count}`);
  console.log(`   Average score:     ${report.average_score}/100`);
  console.log(`   JSON report:       ${jsonPath}`);
  console.log(`   HTML report:       ${htmlPath}`);
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
