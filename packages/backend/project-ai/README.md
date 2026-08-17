# @aikami/backend-project-ai

OpenRouter-backed "ask about Aikami" chat completion, grounded in the
project's generated `.context/llms.txt`.

## Use Case

Three surfaces answer questions about the Aikami project using the same
underlying logic:

- The Discord Interactions Endpoint's `/ask` command
  (`packages/backend/discord-bot/src/lib/interactions`, hosted by
  `apps/backend/worker`).
- The Gateway bot's in-thread conversational replies
  (`packages/backend/discord-bot/src/lib/handlers/message_create.ts`),
  which pass recent thread messages as `history` for continuity.
- The hub's public `POST /api/ask`
  (`apps/frontend/hub/src/lib/server/api/ask.ts`), for the landing page.

This package has no opinion on hosting, auth, or rate limiting — callers own
that. It exports one function, `askProjectAi`, plus the lower-level
`chatCompletion` primitive it's built on (also reused by
`@aikami/backend-discord-bot`'s GitHub-issue summarizer).

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `lint` | `biome lint .` | Lint code with Biome |
| `format` | `biome format .` | Format code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |
| `test` | `bun test` | Run tests |

## Usage

```typescript
import { askProjectAi } from '@aikami/backend-project-ai';

const answer = await askProjectAi({
  question: 'What is Aikami?',
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.OPENROUTER_MODEL,
  history: [], // optional — recent conversation for continuity
});
```

## Structure

```
src/
├── index.ts             # Public exports
└── lib/
    ├── ask_project.ts   # askProjectAi() — llms.txt grounding + cache
    └── openrouter.ts    # chatCompletion() — plain-fetch OpenRouter client
```
