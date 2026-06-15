// apps/e2e/scripts/lpc_man_eval.ts
// LPC Man visual evaluation — uses shared AI eval + screenshot utilities.

import { resolve } from 'node:path';
import { evaluateScreenshot } from './shared/ai_eval';
import { toBase64DataUri } from './shared/screenshot';

const E2E_DIR = resolve(import.meta.dirname, '..');
const SCREENSHOT = resolve(E2E_DIR, 'test-results/lpc-visual/man-debug.png');

const imageDataUri = toBase64DataUri(SCREENSHOT);

const prompt = [
  'This is a screenshot of a pixel-art character from a game called Aikami.',
  'Rate this image on a scale of 0 to 100 based on:',
  '- Is there a visible character on the canvas?',
  '- Does it look like a man with orange buzzcut, beard, white sleeveless shirt, brown shorts, and sandals?',
  '- Are the layers composited correctly (head, body, hair, legs, feet)?',
  '- Is the 64x64 pixel character visible and not cut off?',
  '- Is the dark blue (#0d0d1a) background present?',
  '',
  'Return ONLY a JSON object: {"score": number, "notes": string}',
].join('\n');

const result = await evaluateScreenshot({ imageDataUri, prompt });
console.log(JSON.stringify(result, null, 2));
