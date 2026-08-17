// packages/shared/schemas/src/lib/local_ai/stack_backend.ts
import Type from 'typebox';

/**
 * Hardware backend value set introduced by C-391. Value set matches C-390's
 * `.env.example` `COMPOSE_FILE` backends (`compose.cpu.yaml`,
 * `compose.cuda.yaml`, `compose.rocm.yaml`, `compose.vulkan.yaml`,
 * `compose.intel.yaml`, `compose.musa.yaml`) plus `metal` kept from the
 * C-390 design reference for the native macOS plan.
 */
export const STACK_BACKENDS = ['cpu', 'cuda', 'rocm', 'vulkan', 'intel', 'musa', 'metal'] as const;

export type StackBackendValue = (typeof STACK_BACKENDS)[number];

/**
 * Modality value set introduced by C-391. Matches C-390's `.env.example`
 * `COMPOSE_PROFILES` (`text`, `image`, `voice`, `stt`, `client`, `ollama`,
 * `comfyui`). Note the manifest (C-390) labels the voice model `tts`; the
 * user-facing modality `voice` maps to manifest modality `tts`.
 *
 * `client` was `web` before it was renamed (post-C-391) — it's the game
 * client/app container, not a generic "web" thing; the name was confusing
 * next to the `text`/`image`/`voice`/`stt` engines.
 */
export const STACK_MODALITIES = [
  'text',
  'image',
  'voice',
  'stt',
  'client',
  'ollama',
  'comfyui',
] as const;

export type StackModalityValue = (typeof STACK_MODALITIES)[number];

// TypeBox's Static inference needs a literal TUPLE inside Type.Union, not
// an array — `.map()` on a const tuple widens to `T[]` and Static collapses
// to `never`. This recursive tuple helper preserves the literal order.
type LiteralTupleOf<T extends readonly string[]> = T extends readonly [
  infer First extends string,
  ...infer Rest extends string[],
]
  ? [ReturnType<typeof Type.Literal<First>>, ...LiteralTupleOf<Rest>]
  : [];

const backendSchemas = STACK_BACKENDS.map((backend) => Type.Literal(backend)) as LiteralTupleOf<
  typeof STACK_BACKENDS
>;
export const StackBackendSchema = Type.Union(backendSchemas);

const modalitySchemas = STACK_MODALITIES.map((modality) =>
  Type.Literal(modality),
) as LiteralTupleOf<typeof STACK_MODALITIES>;
export const StackModalitySchema = Type.Union(modalitySchemas);
