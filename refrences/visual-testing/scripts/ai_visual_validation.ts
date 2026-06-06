/** biome-ignore-all lint/style/useNamingConvention: OpenRouter API key env var naming */

// @ts-nocheck
// scripts/ai-visual-validation.ts

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { VISUAL_MANIFEST, type VisualTestDef } from './visual_manifest';

// 1. Manually extract the key from .env to bypass third-party loaders, fallback to process.env
let OpenrouterApiKey = Bun.env.OPENROUTER_API_KEY?.trim();
try {
  const envFile = Bun.file(join(process.cwd(), '.env'));
  if (await envFile.exists()) {
    const envText = await envFile.text();
    const keyLine = envText.split('\n').find((line) => line.startsWith('OPENROUTER_API_KEY='));
    if (keyLine) {
      OpenrouterApiKey = keyLine
        .slice(keyLine.indexOf('=') + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // Silently fall back to process.env if file reading fails
}

if (!OpenrouterApiKey?.startsWith('sk-or-v1-')) {
  throw new Error('❌ CRITICAL: OPENROUTER_API_KEY is missing or invalid.');
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.0-flash-001';
const PASSING_SCORE = 90;
const DEBUG_DIR = join(process.cwd(), '.visual-debug');

if (!existsSync(DEBUG_DIR)) {
  mkdirSync(DEBUG_DIR, { recursive: true });
}

type ScreenshotMeta = {
  fullPath: string;
  baseName: string;
  device: 'desktop' | 'mobile';
  pageName: string;
  testFolder: string;
  manifestDef?: VisualTestDef;
};

function findScreenshots(dir: string): ScreenshotMeta[] {
  const results: ScreenshotMeta[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findScreenshots(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('-actual.png')) {
        const parts = fullPath.split('/');
        const fileName = parts[parts.length - 1] ?? '';
        const parentDir = parts[parts.length - 2] || '';
        const grandparentDir = parts[parts.length - 3] || '';

        // Derive page name from parent directory
        const pageName = parentDir;
        const device = fileName.includes('mobile') ? 'mobile' : 'desktop';
        const baseName = fileName.replace('-actual.png', '');

        // Build manifest key: try <pageName>-<variant> then <pageName>-full-<device>
        const manifestKey = `${pageName}-${baseName}`;
        const manifestKeyFull = `${pageName}-full-${device}`;
        const manifestDef = VISUAL_MANIFEST[manifestKey] || VISUAL_MANIFEST[manifestKeyFull];

        results.push({
          fullPath,
          baseName,
          device,
          pageName,
          testFolder: `${grandparentDir}/${parentDir}`,
          manifestDef,
        });
      }
    }
  } catch {}
  return results;
}

function findSnapshotScreenshots(): ScreenshotMeta[] {
  const results: ScreenshotMeta[] = [];
  try {
    const testsDir = join(process.cwd(), 'tests');
    const entries = readdirSync(testsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith('-snapshots')) {
        const snapDir = join(testsDir, entry.name);
        const files = readdirSync(snapDir, { withFileTypes: true });
        for (const file of files) {
          if (file.isFile() && file.name.endsWith('.png')) {
            const fullPath = join(snapDir, file.name);
            const fileName = file.name.replace('.png', '');
            const parts = fileName.split('-');
            const isMobile = parts.includes('Mobile') && parts.includes('Chrome');
            const device = isMobile ? 'mobile' : 'desktop';
            // Remove trailing browser/os parts: for desktop remove last 2, for mobile remove last 3 (Mobile-Chrome-linux)
            const dropCount = isMobile ? 3 : 2;
            const baseName = parts.slice(0, -dropCount).join('-');

            let pageName = 'chat';
            if (baseName.includes('home')) {
              pageName = 'home';
            }
            if (baseName.includes('chat')) {
              pageName = 'chat';
            }

            results.push({
              fullPath,
              baseName,
              device,
              pageName,
              testFolder: entry.name,
              manifestDef: VISUAL_MANIFEST[baseName],
            });
          }
        }
      }
    }
  } catch {}
  return results;
}

function getReferenceImage(
  pageName: string,
  device: 'desktop' | 'mobile',
): { path: string; isFallback: boolean } {
  const basePath = join(process.cwd(), 'refrences', 'pages', pageName);
  const idealPath = join(basePath, device, 'screen.png');
  const desktopFallbackPath = join(basePath, 'desktop', 'screen.png');

  if (existsSync(idealPath)) {
    return { path: idealPath, isFallback: false };
  }
  if (existsSync(desktopFallbackPath)) {
    return { path: desktopFallbackPath, isFallback: true };
  }

  throw new Error(
    `No reference image found for page '${pageName}' at ${idealPath} or ${desktopFallbackPath}`,
  );
}

async function optimizeImage(inputPath: string, outputPath: string): Promise<string> {
  await sharp(inputPath)
    .resize({ width: 1280, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(outputPath);
  const file = Bun.file(outputPath);
  return Buffer.from(await file.arrayBuffer()).toString('base64');
}

async function evaluateScreenshot(
  actualBase64: string,
  meta: ScreenshotMeta,
  refBase64?: string,
  isFallback: boolean = false,
): Promise<{ score: number; passed: boolean; visualDiscrepancies: string[] }> {
  const def = meta.manifestDef;
  if (!def) {
    throw new Error('manifestDef is required for evaluateScreenshot');
  }
  const actualDataUri = `data:image/webp;base64,${actualBase64}`;

  const prompt = `
You are an expert QA Visual Inspector analyzing a screenshot of a web UI.
Evaluation Type: ${def.type.toUpperCase()}
Target Device: ${meta.device}
Component State: ${meta.baseName}

CRITICAL INSTRUCTIONS:
- Look ONLY at the images provided. Do NOT rely on memory or cached information.
- Be precise about colors. "Bright blue" means a vivid cyan/sky blue (#0ea5e9). "White" means pure white (#ffffff).
- The trust bar text should read "EU Data Residency • ISO 27001 Certified" — this is correct, NOT a terminal trope.
- User message bubbles ARE bright blue with white text. Assistant bubbles ARE dark slate with light text.
- "SNORRE AI" and "YOU" labels above bubbles ARE intentional design requirements.

RULES & INSTRUCTIONS:
${def.instructions}

${isFallback ? `⚠️ CRITICAL CONTEXT: You are comparing a MOBILE actual implementation against a DESKTOP reference design. DO NOT penalize the implementation for responsive mobile stacking, full-width inputs, or hamburger menus. Only grade the adherence to colors, typography, component styling, and the overall 'Nordic Sentinel' vibe.` : ''}

Give a score from 0 to 100 based on how well the ACTUAL implementation meets the rules.
If the score is below ${PASSING_SCORE}, provide specific descriptions of what is visually wrong.
DO NOT guess or provide Tailwind classes. DO NOT write code.
Just describe the visual discrepancy clearly so a separate, specialized coding AI can figure out how to fix it in the codebase.

Respond with ONLY a JSON object in this exact format (no markdown code blocks):
{
  "score": 85,
  "passed": false,
  "visualDiscrepancies": [
    "[${meta.baseName}] The user message bubble is currently white, but it should be bright blue.",
    "[${meta.baseName}] The top header contains terminal text 'REGION: EU-FRANKFURT' which needs to be removed."
  ]
}
`.trim();

  const messageContent: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: prompt }];

  if (def.type === 'design' && refBase64) {
    messageContent.push({ type: 'text', text: '--- REFERENCE DESIGN ---' });
    messageContent.push({
      type: 'image_url',
      image_url: { url: `data:image/webp;base64,${refBase64}` },
    });
  }

  messageContent.push({ type: 'text', text: '--- ACTUAL IMPLEMENTATION ---' });
  messageContent.push({ type: 'image_url', image_url: { url: actualDataUri } });

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OpenrouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://nordclaw.com',
      'X-Title': 'Nordclaw Visual Validation',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: messageContent }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown Error');
    throw new Error(`OpenRouter API failed (${response.status}): ${errorText}`);
  }

  const jsonResponse = await response.json();
  let content = jsonResponse.choices?.[0]?.message?.content || '';

  content = content
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Could not parse JSON from response: ${content}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    score: typeof parsed.score === 'number' ? parsed.score : 0,
    passed: typeof parsed.score === 'number' ? parsed.score >= PASSING_SCORE : false,
    visualDiscrepancies: Array.isArray(parsed.visualDiscrepancies)
      ? parsed.visualDiscrepancies
      : [],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const coreOnly = args.includes('--core-only');

  const testResultsDir = join(process.cwd(), 'test-results');
  let screenshots = findScreenshots(testResultsDir);

  if (screenshots.length === 0) {
    screenshots = findSnapshotScreenshots();
  }

  if (screenshots.length === 0) {
    process.exit(0);
  }

  let htmlReport = `<!DOCTYPE html>
<html>
<head>
  <title>NordClaw Visual QA</title>
  <style>
    body { background: #0f172a; color: #f8fafc; font-family: system-ui, sans-serif; padding: 2rem; }
    h1 { color: #38bdf8; }
    .container { max-width: 1400px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1rem; }
    .img-container { background: #1e293b; padding: 1rem; border-radius: 8px; border: 1px solid #334155; }
    img { max-width: 100%; height: auto; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
    .feedback { background: #1e293b; padding: 1.5rem; border-radius: 8px; margin-bottom: 4rem; border-left: 4px solid #3b82f6; }
    .pass { color: #22c55e; font-weight: bold; }
    .fail { color: #ef4444; font-weight: bold; }
    .meta { font-family: monospace; color: #94a3b8; font-size: 0.9rem; margin-bottom: 1rem; }
    ul { color: #cbd5e1; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>NordClaw Visual Validation Report</h1>`;

  let allPassed = true;
  const refCache = new Map<string, string>();

  for (const meta of screenshots) {
    if (!meta.manifestDef) {
      continue;
    }

    if (coreOnly && meta.manifestDef.priority > 1) {
      continue;
    }

    const reportName = `${meta.device}--${meta.baseName}`;
    const optimizedActualPath = join(DEBUG_DIR, `${reportName}-actual.webp`);

    try {
      let refBase64: string | undefined;
      let isFallback = false;
      let refHtml = `<div class="img-container"><h3>No Reference (Functional State Test)</h3></div>`;

      if (meta.manifestDef.type === 'design') {
        const refData = getReferenceImage(meta.pageName, meta.device);
        isFallback = refData.isFallback;

        if (!refCache.has(refData.path)) {
          const optimizedRefPath = join(
            DEBUG_DIR,
            `ref-${meta.pageName}-${meta.device.charAt(0)}${isFallback ? '-fb' : ''}.webp`,
          );
          refBase64 = await optimizeImage(refData.path, optimizedRefPath);
          refCache.set(refData.path, refBase64);
        } else {
          refBase64 = refCache.get(refData.path);
        }

        const refFileName = `ref-${meta.pageName}-${meta.device.charAt(0)}${isFallback ? '-fb' : ''}.webp`;
        refHtml = `
          <div class="img-container">
            <h3>Reference Design</h3>
            <img src="./${refFileName}" />
          </div>`;
      }

      const actualBase64 = await optimizeImage(meta.fullPath, optimizedActualPath);
      const result = await evaluateScreenshot(actualBase64, meta, refBase64, isFallback);

      const statusHtml = result.passed
        ? `<span class="pass">✅ PASSED</span>`
        : `<span class="fail">❌ FAILED</span>`;

      let feedbackHtml = '<ul>';
      for (const bug of result.visualDiscrepancies) {
        feedbackHtml += `<li>${bug}</li>`;
        if (!result.passed) {
        }
      }
      if (result.visualDiscrepancies.length === 0 && result.passed) {
        feedbackHtml += `<li>No visual discrepancies found.</li>`;
      }
      feedbackHtml += '</ul>';

      if (!result.passed) {
        allPassed = false;
      }

      htmlReport += `
        <h2>${reportName} - Score: ${result.score}/100 ${statusHtml}</h2>
        <div class="meta">
          Test Context: ${meta.testFolder}<br>
          ${isFallback ? '⚠️ Mobile layout validated against Desktop reference' : ''}
        </div>
        <div class="grid">
          ${refHtml}
          <div class="img-container">
            <h3>Actual Output</h3>
            <img src="./${reportName}-actual.webp" />
          </div>
        </div>
        <div class="feedback">
          <h3>Visual QA Report:</h3>
          ${feedbackHtml}
        </div>
      `;
    } catch (_error) {
      allPassed = false;
    }
  }

  htmlReport += `</div></body></html>`;
  await Bun.write(join(DEBUG_DIR, 'index.html'), htmlReport);

  if (!allPassed) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((_error) => {
  process.exit(1);
});
