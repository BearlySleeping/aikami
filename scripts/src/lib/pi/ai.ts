// scripts/src/lib/pi/ai.ts
//
// Bun-side implementations of the AI bridge commands. The VLM client and
// image optimizer depend on Bun-only packages (sharp) and must never be
// imported by a Node-side pi extension.

import { describeImage, evaluateImage, optimizeImage, toBase64DataUri } from '../ai/index.ts';
import { optionalRecord, optionalString, requireString, toArgs } from './args.ts';
import type { PiHandlers } from './types.ts';

export const handlers: PiHandlers = {
  'ai.optimizeImage': (payload) =>
    optimizeImage({ filepath: requireString(toArgs(payload), 'filepath') }),

  'ai.toDataUri': (payload) => toBase64DataUri(requireString(toArgs(payload), 'filepath')),

  'ai.describeImage': (payload) => {
    const args = toArgs(payload);
    return describeImage({
      imageDataUri: requireString(args, 'imageDataUri'),
      prompt: requireString(args, 'prompt'),
      model: optionalString(args, 'model'),
    });
  },

  'ai.evaluateImage': (payload) => {
    const args = toArgs(payload);
    return evaluateImage({
      imageDataUri: requireString(args, 'imageDataUri'),
      prompt: requireString(args, 'prompt'),
      schema: optionalRecord(args, 'schema'),
      model: optionalString(args, 'model'),
    });
  },
};
