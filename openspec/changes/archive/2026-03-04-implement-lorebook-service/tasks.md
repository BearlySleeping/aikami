## 1. Setup and Scaffolding

- [x] 1.1 Create `packages/backend/ai/src/lib/lorebook.ts`.
- [x] 1.2 Define the `LorebookEntry` interface and provide a temporary mock collection for testing.

## 2. Core Lorebook Logic

- [x] 2.1 Implement the keyword scanning logic in `LorebookService`.
- [x] 2.2 Implement sorting and pruning of lore entries by priority and character limit.
- [x] 2.3 Add unit tests for `LorebookService` to verify scanning and prioritization.

## 3. Integration with AI Messaging

- [x] 3.1 Modify `packages/backend/ai/src/lib/send-message.ts` to integrate with `LorebookService`.
- [x] 3.2 Inject the selected lore entries into the AI prompt's `messages` array as a system message.
- [x] 3.3 Ensure the lore entries are formatted clearly with a header (e.g., "World Info").

## 4. Final Validation

- [x] 4.1 Run tests within the AI package to ensure the `LorebookService` operates as intended and no regressions were introduced.
- [x] 4.2 Manually verify the lore injection functionality by triggering keywords in a sample conversation.
