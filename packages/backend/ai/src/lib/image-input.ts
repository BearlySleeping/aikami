// api/route.ts

import { googleAI } from '@genkit-ai/googleai';
import type { Part } from 'genkit';
import { genkit, z } from 'genkit';
import { simpleEndpoint } from './endpoint.ts';

export const ImageObjectSchema = z.object({
  name: z.string().describe('a short but unique name of the object'),
  description: z.string().describe('a single sentence detailed description of the object'),
  text: z.string().describe('any written text on the object').nullish(),
  colors: z
    .array(z.string())
    .describe(
      'a list of one or more valid CSS named colors that make up the object, from most to least prevalent',
    ),
  box2d: z.array(z.number()).describe('bounding box for the object in [y1,x1,y2,x2] format'),
});

export type ImageObject = z.infer<typeof ImageObjectSchema>;

const ai = genkit({
  plugins: [googleAI()], // set the GOOGLE_API_KEY env variable
  model: googleAI.model('gemini-2.0-flash'),
});

interface Input {
  system: Part[]; // default: "Identify the objects in the provided image."
  imageUrl: string; // base64-encoded data uri
}

export const POST = simpleEndpoint<Input>(async ({ system, imageUrl }) => {
  const { output } = await ai.generate({
    system, // default: "Identify all of the ojects in the provided image."
    prompt: [{ media: { url: imageUrl } }], // base64-encoded data uri
    output: {
      schema: z.object({
        objects: z.array(ImageObjectSchema).describe('list of objects in the image'),
      }),
    },
  });

  return output;
});
