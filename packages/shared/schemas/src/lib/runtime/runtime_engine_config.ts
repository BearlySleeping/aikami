// packages/shared/schemas/src/lib/runtime/runtime_engine_config.ts
//
// Runtime engine configuration (C-389). Validates the `config.json` document
// that deployment paths emit beside `index.html` (or in the Tauri app config
// directory). Every field is optional because the document may omit any
// engine; the loader resolves missing URLs to unset (precedence rung 5) so
// the SPA bundle stays topology-agnostic — no engine URL literal may exist
// in a production build.
import Type from 'typebox';

/** Where speech synthesis runs. */
export const TtsModeSchema = Type.Union([
  Type.Literal('browser'),
  Type.Literal('server'),
  Type.Literal('disabled'),
]);
export type TtsMode = Type.Static<typeof TtsModeSchema>;

/** Image engine selector (reserved for C-390 topology work). */
export const ImageEngineSchema = Type.Union([
  Type.Literal('auto'),
  Type.Literal('sdcpp'),
  Type.Literal('comfyui'),
]);
export type ImageEngine = Type.Static<typeof ImageEngineSchema>;

/**
 * URL-valued field. The example config document uses `null` for "not
 * configured", so both `string` and `null` are accepted; absent is the
 * third state.
 *
 * Security (C-389): only `http(s)` engine URLs are accepted — anything
 * else (javascript:, file:, relative paths) fails schema validation so
 * the loader falls back down the precedence chain instead of passing a
 * hostile URL to fetch(). The pattern also requires a non-empty
 * authority (rejects bare `http://`, `http:///path`, trailing spaces in
 * the host) so a malformed document cannot pass as "configured" (C-389
 * CR — validation via strict pattern in the schema module; the loader's
 * fetch layer performs the final URL parse).
 */
export const RuntimeUrlSchema = Type.Optional(
  Type.Union([Type.String({ pattern: '^https?://[^/\\s]+(/[^\\s]*)?$' }), Type.Null()]),
);

/** Text (LLM) engine entry. */
export const RuntimeTextConfigSchema = Type.Object({
  url: RuntimeUrlSchema,
  model: Type.Optional(Type.String({ description: 'Default model id.' })),
});
export type RuntimeTextConfig = Type.Static<typeof RuntimeTextConfigSchema>;

/** Image engine entry. */
export const RuntimeImageConfigSchema = Type.Object({
  url: RuntimeUrlSchema,
  engine: Type.Optional(ImageEngineSchema),
});
export type RuntimeImageConfig = Type.Static<typeof RuntimeImageConfigSchema>;

/** Voice TTS entry — `mode` selects the synthesis path. */
export const RuntimeVoiceTtsConfigSchema = Type.Object({
  mode: Type.Optional(TtsModeSchema),
  url: RuntimeUrlSchema,
});
export type RuntimeVoiceTtsConfig = Type.Static<typeof RuntimeVoiceTtsConfigSchema>;

/** Voice STT entry — reserved for C-359; not consumed by this contract. */
export const RuntimeVoiceSttConfigSchema = Type.Object({
  url: RuntimeUrlSchema,
});
export type RuntimeVoiceSttConfig = Type.Static<typeof RuntimeVoiceSttConfigSchema>;

/** Voice entry. */
export const RuntimeVoiceConfigSchema = Type.Object({
  tts: Type.Optional(RuntimeVoiceTtsConfigSchema),
  stt: Type.Optional(RuntimeVoiceSttConfigSchema),
});
export type RuntimeVoiceConfig = Type.Static<typeof RuntimeVoiceConfigSchema>;

/** One-time model asset download origin (Kokoro weights, ONNX runtime). */
export const RuntimeModelsConfigSchema = Type.Object({
  originUrl: RuntimeUrlSchema,
});
export type RuntimeModelsConfig = Type.Static<typeof RuntimeModelsConfigSchema>;

/**
 * The runtime `config.json` document shape. All fields optional — a missing
 * field means "unset", never a baked-in default.
 */
export const RuntimeEngineConfigSchema = Type.Object({
  text: Type.Optional(RuntimeTextConfigSchema),
  image: Type.Optional(RuntimeImageConfigSchema),
  voice: Type.Optional(RuntimeVoiceConfigSchema),
  models: Type.Optional(RuntimeModelsConfigSchema),
});
export type RuntimeEngineConfig = Type.Static<typeof RuntimeEngineConfigSchema>;
