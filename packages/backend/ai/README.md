# @aikami/backend-ai

AI-related functionalities and integrations using Google Genkit.

## Use Case

This package provides AI capabilities for the Aikami application, including:
- AI model integrations (OpenAI, Anthropic, OpenRouter)
- Prompt engineering utilities
- AI-powered feature implementations
- Flow-based AI processing with Genkit

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` - Constant values
- `@aikami/schemas` - Zod schemas for AI I/O validation
- `@aikami/types` - Type definitions

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `check` | `bun run check` | Run TypeScript type checking |
| `format` | `bun run format` | Format code with Biome |
| `lint` | `bun run lint` | Lint code with Biome |

## Usage

```typescript
import { generatePersona, sendMessage } from '@aikami/backend-ai';
```

## Features

- **Multi-provider support** - OpenAI, Anthropic, OpenRouter
- **Flow-based processing** - Genkit flows for complex AI operations
- **Schema validation** - Input/output validation with Zod
- **Image generation** - AI image processing capabilities
