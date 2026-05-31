# @aikami/backend-ai

Vendor-agnostic AI service layer with OpenAI, Gemini, and mock providers.

## Use Case

This package provides a unified interface for AI service interactions used in Firebase Functions and server-side code:
- Text generation via OpenAI and Gemini
- Token-aware rate limiting and circuit breaking
- Pluggable provider architecture for vendor flexibility
- Retry logic with exponential backoff

## Where It's Used

Used by Firebase Cloud Functions (`apps/backend/firebase`) and any server-side code that needs AI capabilities.

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` — Constant values
- `@aikami/schemas` — Zod schemas for validation
- `@aikami/types` — Type definitions
- `@aikami/logger` — Logging utilities
- `@aikami/utils` — Shared utilities
- `zod` — Schema validation

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsc --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |
| `test` | `bun test` | Run tests |

## Usage

```typescript
import { createAiService } from '@aikami/backend-ai';

// Factory creates the right provider based on config
const ai = createAiService({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
});

const response = await ai.generateText({
  messages: [{ role: 'user', content: 'Hello!' }],
  model: 'gpt-4o',
});
```

## Architecture

- **AiServiceInterface** — Abstract contract all providers implement
- **OpenAiService** — OpenAI API integration
- **GeminiService** — Google Gemini API integration
- **BaseAiService** — Shared foundation (retry, rate limiting, logging)
- **CircuitBreaker** — Prevents cascading failures on upstream outages
- **TokenBucketRateLimiter** — Client-side rate limiting per second / burst
