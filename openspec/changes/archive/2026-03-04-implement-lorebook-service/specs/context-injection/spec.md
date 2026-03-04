## ADDED Requirements

### Requirement: Scan text for lorebook keywords
The `LorebookService` SHALL scan a provided block of text (typically conversation history) for occurrences of activation keywords defined in the lorebook entries.

#### Scenario: Keywords found in text
- **WHEN** the text "The king of the realm is wise." is scanned with an entry for the keyword "king"
- **THEN** the entry is marked as activated for the current context

### Requirement: Prioritize and limit activated lore entries
The `LorebookService` SHALL prioritize activated lore entries based on their defined priority and a provided maximum context budget (e.g., character or token limit).

#### Scenario: High priority entries first
- **WHEN** multiple lore entries are activated and their combined size exceeds the token budget
- **THEN** entries with higher priority are selected over those with lower priority

### Requirement: Format lore entries for prompt injection
The system SHALL format selected lore entries into a concise string format suitable for inclusion in an AI model prompt (e.g., prefixed with "World Info:" or within special tags).

#### Scenario: Successful formatting
- **WHEN** two lore entries are selected for injection
- **THEN** they are formatted into a single string with clear separation and descriptive headers
