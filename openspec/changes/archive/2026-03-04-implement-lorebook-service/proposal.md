## Why

The AI NPC dialogue system currently lacks a way to provide deep, world-specific context efficiently. A `LorebookService` will allow the system to inject relevant world data (lore, history, character info) into the AI's context dynamically when specific keywords are triggered, enhancing the richness and consistency of the AI's responses without overwhelming the context window.

## What Changes

- Implement a `LorebookService` in the SvelteKit PWA.
- Define a structure for lorebook entries, including activation keywords, content, and priority.
- Integrate the `LorebookService` with the existing AI dialogue system.
- Add logic to scan conversation history for keywords and retrieve associated lore entries.
- Implement a mechanism to format and inject these entries into the AI prompt.

## Capabilities

### New Capabilities
- `lorebook-management`: Define and manage lorebook entries, including their structure and retrieval mechanisms.
- `context-injection`: Handle the scanning of dialogue for keywords and the subsequent injection of relevant lore into the AI's context window.

### Modified Capabilities
<!-- None. -->

## Impact

- **AI Dialogue System**: Will now interact with the `LorebookService` to enrich prompts.
- **SvelteKit PWA**: New service implementation and potential UI for lorebook management.
- **Data Schemas**: New structures for lorebook entries and their storage.
