# @aikami/frontend-ai-gateway

Unified AI Provider Gateway — one typed, mode-resolving call surface
(`generateText` / `generateImage` / `generateVoice` / `detect`) for the three
AI capabilities across `offline` / `byok` / `service` modes. Built by C-320.

## Use Case

- Resolve which (mode, provider) serves a capability exactly once at the
  gateway boundary — call sites never re-check providers.
- Wrap existing provider code (Ollama/OpenRouter/OpenAI SSE streaming,
  ComfyUI image generation, Kokoro TTS) behind uniform adapter contracts.
- Normalize every failure to a typed `AiGatewayError` (shape in
  `@aikami/types`) with `code`, `capability`, `mode`, and `retryable`.
- Bounded provider detection (≤3s) convertible to the existing
  `DetectionStatus` union.

## Where It's Used

`apps/frontend/client` composes the gateway in
`src/lib/services/ai/ai_gateway_service.svelte.ts`; `text_generation_service`
and `ai_service` delegate to it. C-322/C-323/C-324 build on this surface.

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` — shared constants
- `@aikami/schemas` — TypeBox gateway schemas + `schemaCheck`
- `@aikami/types` — `AiMode`, `AiCapability`, `AiGatewayError`, `AiModeResolution`, `AiDetectionResult`
- `@aikami/logger` — logging

## Tasks

| Task        | Command                 | Description                   |
| ----------- | ----------------------- | ----------------------------- |
| `typecheck` | `tsgo --noEmit`         | Run TypeScript type checking  |
| `format`    | `biome format .`        | Format code with Biome        |
| `lint`      | `biome lint .`          | Lint code with Biome          |
| `fix`       | `biome check --write .` | Auto-fix lint & format issues |
| `test`      | `bun test`              | Run unit tests                |

## Usage

```typescript
import {
  createAdapterRegistry,
  createAiProviderGateway,
  createModeResolver,
  createOpenAiCompatibleTextAdapter,
} from '@aikami/frontend/ai-gateway';

const registry = createAdapterRegistry();
const textAdapter = createOpenAiCompatibleTextAdapter({ getApiKey });
registry.registerText({ mode: 'offline', adapter: textAdapter });
registry.registerText({ mode: 'byok', adapter: textAdapter });

const gateway = createAiProviderGateway({
  registry,
  resolveMode: createModeResolver({ getConfig }),
});

const { text } = await gateway.generateText({
  messages: [{ role: 'user', content: 'Hello' }],
  onChunk: (token) => console.log(token),
});
```

## Project Structure

```
src/
├── index.ts                             # Public entry point
└── lib/
    ├── adapter_registry.ts              # (capability, mode) → adapter
    ├── detection.ts                     # Bounded provider detection
    ├── errors.ts                        # AiGatewayException + normalization
    ├── gateway.ts                       # Default gateway implementation
    ├── gateway_types.ts                 # Call surface + adapter contracts
    ├── mode_resolver.ts                 # Config-backed mode resolution
    ├── sse.ts                           # Chat-completions SSE reader
    ├── structured.ts                    # Strict-schema extraction helpers
    ├── text_adapter_openai_compatible.ts# offline + byok text transport
    ├── text_adapter_service.ts          # service-mode adapter + stub
    ├── image_adapter.ts                 # Delegating image adapter
    └── voice_adapter.ts                 # Delegating voice adapter
```

## Architecture

The gateway core is environment-agnostic (no browser globals outside
client-only adapters) so the same contracts can back the server mirror
(`packages/backend/ai` migration is C-324). The `service` mode ships an
interface-conformant adapter and a deterministic stub; hosted activation,
billing, and metering are Phase 5.
