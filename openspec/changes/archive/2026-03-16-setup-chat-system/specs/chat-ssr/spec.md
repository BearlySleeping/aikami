## ADDED Requirements

### Requirement: Chat page SSR loads chat and NPC data
The system SHALL fetch chat and NPC data on the server before rendering the page.

#### Scenario: SSR loads chat document
- **WHEN** user navigates to `/chat/{chatId}`
- **THEN** server fetches chat document from Firestore
- **AND** chat data is passed to page component

#### Scenario: SSR loads NPC data
- **WHEN** server fetches chat document
- **THEN** server also fetches NPC document using npcId from chat
- **AND** NPC data is passed to page component

#### Scenario: Chat not found
- **WHEN** chatId doesn't exist in Firestore
- **THEN** 404 error is returned
- **AND** "Chat not found" message displayed

#### Scenario: NPC not found for chat
- **WHEN** chat exists but NPC is deleted/missing
- **THEN** 404 error is returned
- **AND** "Character not found" message displayed

### Requirement: SSR data passed to view model
The system SHALL pass SSR-loaded data to the chat view model to avoid redundant fetches.

#### Scenario: View model receives SSR data
- **WHEN** page loads with SSR data
- **THEN** view model initializes with passed data
- **AND** view model skips fetching if data already available

#### Scenario: Client hydration
- **WHEN** SSR data is available
- **THEN** view model uses SSR data immediately
- **AND** background refresh happens if needed

### Requirement: SSR works with authentication
The system SHALL verify user authorization during SSR.

#### Scenario: Unauthenticated access
- **WHEN** unauthenticated user tries to access chat
- **THEN** redirect to login page
- **AND** returnUrl points back to requested chat

#### Scenario: Accessing another user's chat
- **WHEN** user tries to access chat they don't own
- **THEN** 403 Forbidden error
- **AND** "You don't have access to this chat" message

### Requirement: Chat route loads with npcId query param
The system SHALL support npcId in URL query for NPC context.

#### Scenario: Navigate with npcId
- **WHEN** user navigates to `/chat/{chatId}?npcId={npcId}`
- **THEN** npcId is used to fetch NPC features
- **AND** chat is fetched using chatId

#### Scenario: npcId from chat document
- **WHEN** npcId is not in URL
- **THEN** npcId is extracted from chat.npcId
- **AND** NPC data is fetched using that id

### Requirement: SSR handles loading states
The system SHALL show appropriate loading states during SSR.

#### Scenario: SSR loading
- **WHEN** server is fetching data
- **THEN** streaming SSR shows skeleton/loading
- **AND** page becomes interactive once data arrives
