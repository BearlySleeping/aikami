# Contract: C-019 Macro & Slash Command Engine

## Design References
- SillyTavern AST Macro Parser 
- RisuAI ChatML Parser
- Aikami Core: `apps/frontend/game/src/engine/engine_bridge.ts`
- Aikami UI: `apps/frontend/pwa/src/lib/client/services/chat/chat.svelte.ts`

## Detailed Changes
1. **Package Creation**: Establish a new utility library at `packages/shared/parser` utilizing the `typescript-library.yml` Moon template.
2. **Lexer/Parser**: Implement a strict, regex-based tokenizer and parser that isolates `/command [args]` and `{{macro}}` blocks from standard dialogue text.
3. **Engine Bridge Integration**: Update `engine_bridge.ts` to expose an `executeCommand(cmd: string, args: string[])` method. 
4. **Chat View Model Binding**: Modify `chat.svelte.ts` to intercept user input. Route `/` prefixes through the parser to the Engine Bridge.
5. **Supported Base Commands**: Implement `/roll [dice]` and `/move [x] [y]`.

## Acceptance Criteria
- **Given** the user is in the active game chat UI.
- **When** the user types `/roll 1d20` and hits enter.
- **Then** the message is NOT sent to the AI service.
- **Then** the parser extracts the command, invokes `dice_service.ts`, and emits a local system message.
- **When** the AI responds with `{{trigger_anim:attack}}`.
- **Then** the parser strips the macro from the UI text and fires the `attack` event via `engine_bridge.ts`.

## Watch Points
- **Strict Typing**: All parsed AST nodes must have exhaustive Zod/Valibot schemas defined.
- **Performance**: The parser must evaluate AI streams on-the-fly without blocking the main thread.
- **Monorepo Boundaries**: The parser must be framework-agnostic.
