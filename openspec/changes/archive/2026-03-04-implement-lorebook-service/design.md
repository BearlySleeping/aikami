## Context

The AI dialogue system needs a way to inject world-specific context (lore) dynamically. Currently, context is limited to a system prompt and recent message history. A `LorebookService` will enable searching for keywords in the conversation and injecting corresponding lore entries into the AI prompt.

## Goals / Non-Goals

**Goals:**
- Provide a structured way to define lorebook entries (keywords, content, priority).
- Implement a service to scan text for these keywords.
- Integrate this service into the `sendMessage` flow in `packages/backend/ai`.
- Support prioritizing entries to fit within context limits.

**Non-Goals:**
- Complex natural language processing for keyword matching (simple case-insensitive substring matching is sufficient for V1).
- A full UI for managing lorebooks in this phase.
- Persistent storage of lorebooks in a database (will be passed via context or loaded from configuration for now).

## Decisions

- **Location**: Implementation will reside in `packages/backend/ai/src/lib/lorebook.ts`.
- **Data Structure**: 
  ```typescript
  interface LorebookEntry {
    id: string;
    keywords: string[];
    content: string;
    priority: number; // Higher values indicate higher priority
  }
  ```
- **Matching Strategy**: The service will scan the most recent messages (e.g., the last 5-10) for any defined keywords.
- **Injection Point**: Lore entries will be injected into the `sendMessage` flow. Activated entries will be aggregated and added as a `system` message immediately following the main system prompt.
- **Priority & Limits**: If multiple entries are activated, they will be sorted by `priority`. A character limit (e.g., 2000 characters) will be enforced to prevent overwhelming the AI's context window.

## Risks / Trade-offs

- **[Risk] Performance**: Scanning large amounts of text against many keywords could introduce latency. 
  - **[Mitigation]**: Limit the scan to the most recent messages and the current user input.
- **[Risk] Context Pollution**: Irrelevant lore might be injected if keywords are too broad.
  - **[Mitigation]**: Encourage specific keywords and use priority to ensure the most relevant info is included first.
- **[Trade-off] Simple Matching**: Substring matching might miss variations of words (e.g., "king" vs "kings").
  - **[Decision]**: Accept this limitation for V1 to keep implementation simple and predictable.
