## ADDED Requirements

### Requirement: Define Lorebook Entry structure
The system SHALL define a structured `LorebookEntry` format that includes unique identification, a set of activation keywords, the content to be injected, and an optional priority for ordering.

#### Scenario: Valid entry definition
- **WHEN** a `LorebookEntry` is created with a unique ID, keywords ["king", "throne"], content "The King sits on a golden throne.", and priority 10
- **THEN** the entry is successfully validated as a correct structure

### Requirement: Manage a collection of Lorebook entries
The `LorebookService` SHALL provide methods to add, retrieve, update, and remove `LorebookEntry` items from its internal collection.

#### Scenario: Adding and retrieving entries
- **WHEN** three unique `LorebookEntry` items are added to the service
- **THEN** a call to retrieve all entries returns a collection containing all three items

### Requirement: Keyword-based lookup
The `LorebookService` SHALL allow for efficient lookup of entries based on a set of provided keywords.

#### Scenario: Lookup by keyword
- **WHEN** the service is queried with the keyword "king"
- **THEN** all entries containing "king" in their activation keywords are returned
