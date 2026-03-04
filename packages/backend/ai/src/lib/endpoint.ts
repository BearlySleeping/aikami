// biome-disable-file noExplicitAny

import { getRealTimeDatabase } from '@aikami/backend/configs/realtime-database.ts';
import { verifyIdToken } from '@aikami/backend/utils/auth.ts';

export function toReadableStream(
  response: GenerateStreamResponse,
  options?: {
    transform?: (chunk: GenerateResponseChunkData & { output: unknown }) => any;
    errorRef?: { current?: { message: string } };
  },
) {
  return new ReadableStream({
    async start(controller) {
      function enqueue(data: any) {
        const out = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(out);
      }

      try {
        for await (const chunk of response.stream) {
          enqueue({
            message: options?.transform
              ? options.transform(chunk)
              : { ...chunk.toJSON(), output: chunk.output },
          });
        }

        const result = await response.response;
        console.dir(result.messages, { depth: null });

        enqueue({
          result: {
            messages: [...result.messages],
            output: result.output,
          },
        });
      } catch (e) {
        console.error((e as Error).stack);
        enqueue({ error: { message: (e as Error).message } });
      } finally {
        setTimeout(() => {
          controller.close();
        }, 100);
      }
    },
  });
}

import process from 'node:process';
import {
  type GenerateResponseChunkData,
  type GenerateStreamResponse,
  MessageSchema,
  PartSchema,
  z,
} from 'genkit';
import { ToolRequestPartSchema, ToolResponsePartSchema } from 'genkit/model';

export const GenerateRequestSchema = z.object({
  system: z.array(PartSchema).optional(),
  messages: z.array(MessageSchema).optional(),
  prompt: z.array(PartSchema).optional(),
  resume: z
    .object({
      respond: z.array(ToolResponsePartSchema).optional(),
      restart: z.array(ToolRequestPartSchema).optional(),
    })
    .optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

if (process.env.NODE_ENV === 'production') {
  import('@genkit-ai/firebase').then(({ enableFirebaseTelemetry }) => {
    enableFirebaseTelemetry();
  });
}

const ChatRequestSchema = GenerateRequestSchema.extend({
  context: z.record(z.any()).optional(),
});

export type ChatHandler<T = z.infer<typeof ChatRequestSchema>> = (
  data: T,
) => GenerateStreamResponse<any> | Promise<GenerateStreamResponse<any>>;

export interface ChatEndpointOptions<T extends z.ZodTypeAny = z.ZodTypeAny> {
  schema?: T;
}

type Endpoint = (request: Request) => Promise<Response>;

function errorResponse(error: { message: string; status: number }) {
  return new Response(JSON.stringify(error), {
    status: error.status,
    headers: { 'content-type': 'application/json' },
  });
}

async function checkRateLimit(uid: string): Promise<number> {
  const hourBucket = new Date().toISOString().substring(0, 13);
  let newValue: number = 0;
  const { committed, snapshot } = await getRealTimeDatabase()
    .ref(`limits/${hourBucket}/${uid}`)
    .transaction((count) => {
      newValue = (count || 0) + 1;
      return newValue;
    });
  if (!committed) return 10000000;
  return snapshot.val();
}

const MAX_REQUESTS_HOURLY = parseInt(process.env.MAX_REQUESTS_HOURLY || '120', 10);

async function authorize(request: Request): Promise<Response | null> {
  const idToken = request.headers.get('authorization')?.split(' ')[1];
  if (!idToken) {
    return errorResponse({
      message: 'You must be authenticated to make requests to demos.',
      status: 403,
    });
  }
  const { uid } = await verifyIdToken(idToken);
  const numRequests = await checkRateLimit(uid);
  if (numRequests > MAX_REQUESTS_HOURLY) {
    return errorResponse({
      status: 429,
      message: 'You have reached your demo request limit for the hour. Come back later.',
    });
  }
  return null;
}

export function simpleEndpoint<Input = any, Output = any>(
  handler: (input: Input) => Promise<Output>,
) {
  return async (request: Request): Promise<Response> => {
    const authError = await authorize(request);
    if (authError) return authError;

    const input: Input = await request.json();

    try {
      const output = await handler(input);
      return Response.json(output);
    } catch (e) {
      return Response.json({ error: { message: (e as Error).toString() } }, { status: 500 });
    }
  };
}

export default function genkitEndpoint(handler: ChatHandler): Endpoint;
export default function genkitEndpoint<T extends z.ZodTypeAny = z.ZodTypeAny>(
  options: ChatEndpointOptions<T>,
  handler: ChatHandler<z.infer<T>>,
): Endpoint;
export default function genkitEndpoint<T extends z.ZodTypeAny = z.ZodTypeAny>(
  optionsOrHandler: ChatEndpointOptions<T> | ChatHandler<z.infer<T>>,
  handler?: ChatHandler<z.infer<T>>,
): Endpoint {
  const options = handler ? (optionsOrHandler as ChatEndpointOptions) : {};
  handler = handler || (optionsOrHandler as ChatHandler);

  return async (request: Request): Promise<Response> => {
    const authError = await authorize(request);
    if (authError) return authError;

    const schema = options.schema || ChatRequestSchema;
    const data = schema.parse(await request.json());

    if (process.env.NODE_ENV === 'development') {
      console.dir(data, { depth: null });
    }
    try {
      const response = await handler(data);
      return new Response(toReadableStream(response), {
        headers: { 'content-type': 'text/event-stream' },
      });
    } catch (e) {
      return new Response(
        `data: ${JSON.stringify({
          error: { message: (e as Error).message },
        })}\n\n`,
        {
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    }
  };
}
