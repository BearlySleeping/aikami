import { $ } from 'bun';
import { readFileSync } from 'fs';
import { resolve } from 'node:path';

const E2E_DIR = resolve(import.meta.dirname, '..');
const SCREENSHOT = resolve(E2E_DIR, 'test-results/lpc-visual/man-debug.png');

// Read and convert to base64
const imgBuf = readFileSync(SCREENSHOT);
const base64 = imgBuf.toString('base64');

const prompt = `This is a screenshot of a pixel-art character from a game called Aikami.
Rate this image on a scale of 0 to 100 based on:
- Is there a visible character on the canvas?
- Does it look like a man with orange buzzcut, beard, white sleeveless shirt, brown shorts, and sandals?
- Are the layers composited correctly (head, body, hair, legs, feet)?
- Is the 64x64 pixel character visible and not cut off?
- Is the dark blue (#0d0d1a) background present?

Return ONLY a JSON object: {"score": number, "notes": string}`;

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'google/gemini-2.5-flash',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
        ],
      },
    ],
  }),
});

const data = (await res.json()) as any;
const content = data.choices?.[0]?.message?.content || '';
console.log(content);
