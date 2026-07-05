// packages/shared/constants/src/lib/providers.ts
//
// Provider registry constants used by both frontend and backend.
// These are pure data — no service logic, no state, no encryption.

/** Text generation provider descriptors. */
export const TEXT_PROVIDERS = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Multi-model aggregator',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT models via OpenAI API',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    description: 'Gemini models via Google AI',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek V3/R1 models',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    description: 'Mistral models via La Plateforme',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'cohere',
    label: 'Cohere',
    description: 'Command R models',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    description: 'Open-source model hosting',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'nanogpt',
    label: 'NanoGPT',
    description: 'Pay-per-token model access',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'novelai',
    label: 'NovelAI',
    description: 'Kayra / Clio story models',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'aws',
    label: 'AWS Bedrock',
    description: 'Claude via AWS',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'horde',
    label: 'AI Horde',
    description: 'Volunteer compute cluster',
    needsKey: false,
    isLocal: false,
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    description: 'Local LLM server',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
  },
  {
    id: 'ooba',
    label: 'TextGen WebUI',
    description: 'Local Oobabooga server',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
  },
  {
    id: 'custom',
    label: 'Custom API',
    description: 'OpenAI-compatible endpoint',
    needsKey: false,
    needsUrl: true,
    isLocal: false,
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  description: string;
  needsKey: boolean;
  needsUrl?: boolean;
  isLocal: boolean;
}>;

/** Provider identifier extracted from TEXT_PROVIDERS union. */
export type TextProvider = (typeof TEXT_PROVIDERS)[number]['id'];

/** Built-in generation parameter presets (read-only). */
export const BUILT_IN_PRESETS = [
  {
    id: 'creative',
    isBuiltIn: true,
    name: 'Creative',
    params: {
      contextSize: 4096,
      maxTokens: 1024,
      presencePenalty: 0.2,
      repetitionPenalty: 1.05,
      temperature: 0.9,
      topK: 50,
      topP: 0.95,
    },
  },
  {
    id: 'precise',
    isBuiltIn: true,
    name: 'Precise',
    params: {
      contextSize: 4096,
      maxTokens: 512,
      presencePenalty: -0.1,
      repetitionPenalty: 1.15,
      temperature: 0.3,
      topK: 20,
      topP: 0.5,
    },
  },
  {
    id: 'balanced',
    isBuiltIn: true,
    name: 'Balanced',
    params: {
      contextSize: 4096,
      maxTokens: 1024,
      presencePenalty: 0,
      repetitionPenalty: 1.1,
      temperature: 0.7,
      topK: 40,
      topP: 0.9,
    },
  },
  {
    id: 'dnd-gm',
    isBuiltIn: true,
    name: 'D&D GM',
    params: {
      contextSize: 8192,
      maxTokens: 2048,
      presencePenalty: 0.3,
      repetitionPenalty: 1.08,
      temperature: 0.85,
      topK: 60,
      topP: 0.92,
    },
  },
] as const;

/** Generation parameter preset type. */
export type GenParamPreset = {
  id: string;
  name: string;
  params: {
    temperature: number;
    topP: number;
    topK: number;
    repetitionPenalty: number;
    presencePenalty: number;
    maxTokens: number;
    contextSize: number;
  };
  isBuiltIn: boolean;
};
