# @aikami/parser

Macro & slash command parser for AI dialogue streams.

## Use Case

- Intercepts `/command [args]` syntax in chat input, routing to game engine instead of AI
- Strips `{{macro:args}}` tokens from AI responses, dispatching them to the game engine
- Streaming-safe — handles macros split across network chunks via `StreamBuffer`

## Where It's Used

- `apps/frontend/client` — Chat ViewModel intercepts slash commands and processes macros in AI responses
- Future: any frontend or backend code that needs to parse `{{macro}}` or `/command` syntax

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/schemas` — Zod schemas for AST node validation (CommandNode, MacroNode, TextNode)

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |
| `test` | `bun test` | Run unit tests |

## Usage

```typescript
import { parseLine, parseStreamChunk, createStreamBuffer } from "@aikami/parser";

// Parse a slash command
const { command } = parseLine("/roll 1d20");
// command = { type: "command", command: "roll", args: ["1d20"], raw: "/roll 1d20" }

// Stream-safe macro parsing
const buf = createStreamBuffer();
const result = parseStreamChunk("Hello {{anim:wave}}!", buf);
// result.displayText = "Hello !"
// result.macros = [{ type: "macro", name: "anim", args: ["wave"] }]
```

## Architecture

```
src/
├── index.ts        # Public entry point — re-exports from lib/
└── lib/
    ├── lexer.ts     # Regex-based tokenizer (tokenizeLine, extractMacros, stripMacros)
    ├── parser.ts    # High-level parser (parseLine, parseStreamChunk, StreamBuffer)
    └── types.ts     # Type aliases and re-exports from @aikami/schemas

tests/
└── parser.test.ts   # 37 unit tests covering commands, macros, and streaming
```
