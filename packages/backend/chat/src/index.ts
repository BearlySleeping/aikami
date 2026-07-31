// packages/backend/chat/src/index.ts
//
// Reserved for future self-hosted LLM serving. Not wired into any Firebase
// callables or client services. Preserved from the former @aikami/backend-ai
// package for reference when server-side AI is implemented.

export type { AiServiceInterface } from './lib/ai_service_interface.ts';
export { handleAIEndpoint } from './lib/api_handler.ts';
export { BaseAiService } from './lib/base_ai_service.ts';
export { AiServiceError } from './lib/errors.ts';
export { createAiService } from './lib/factory.ts';
export { GeminiService } from './lib/gemini_service.ts';
export { OpenAiService } from './lib/openai_service.ts';

export type {
  AiServiceErrorCode,
  BaseAiServiceOptions,
  CreateAiServiceOptions,
  GeminiServiceOptions,
  OpenAiServiceOptions,
  RetryConfig,
} from './lib/types.ts';
