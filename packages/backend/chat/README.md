# @aikami/backend-chat

> ⚠️ **Not in use yet.** This package is reserved for future self-hosted LLM
> serving (running inference models in the Aikami backend). Currently, users
> host LLMs locally (Ollama/Ooba) or bring their own API keys (BYOK).

## Future intent

This package will provide:
- Vendor-agnostic AI service layer (OpenAI, Gemini, and mock providers)
- Token-aware rate limiting and circuit breaking
- Pluggable provider architecture
- Retry logic with exponential backoff

## Current status

Code preserved from the former `@aikami/backend-ai` package — retained for
reference when server-side LLM serving is implemented. Not wired into any
Firebase callables or client services.

## Dependencies

- `@aikami/constants` — Constant values
- `@aikami/schemas` — TypeBox schemas for validation
- `@aikami/types` — Type definitions
- `@aikami/logger` — Logging utilities
- `@aikami/utils` — Shared utilities
- `typebox` — Schema validation

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |
| `test` | `bun test` | Run tests |
