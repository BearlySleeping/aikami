## ADDED Requirements

### Requirement: Clicking NPC in list starts or opens chat
The system SHALL allow users to start a chat with an NPC by clicking on the NPC in the list view.

#### Scenario: Create new chat from NPC list
- **WHEN** user clicks on NPC in NPC list
- **AND** no chat exists for this user+NPC combination
- **THEN** a new chat document is created in Firestore
- **AND** user is navigated to `/chat/{chatId}?npcId={npcId}`

#### Scenario: Open existing chat from NPC list
- **WHEN** user clicks on NPC in NPC list
- **AND** a chat already exists for this user+NPC combination
- **THEN** user is navigated to `/chat/{existingChatId}?npcId={npcId}`

#### Scenario: NPC list shows chat indicator
- **WHEN** NPC has an existing chat
- **THEN** NPC list item shows indicator (icon or badge)
- **AND** shows last message preview or timestamp

### Requirement: NPC list shows user's chats
The system SHALL display a dedicated section or tab showing the user's active chats.

#### Scenario: View chats section
- **WHEN** user is on NPC list page
- **THEN** "Chats" section is visible
- **AND** shows all chats with NPC name, avatar, last message, timestamp

#### Scenario: Delete chat from list
- **WHEN** user swipes or clicks delete on chat item
- **THEN** confirmation dialog appears
- **AND** on confirm, chat and all messages are deleted

### Requirement: Chat URL includes NPC ID for context
The system SHALL include NPC ID in URL query params for NPC-specific features.

#### Scenario: Chat URL structure
- **WHEN** user navigates to chat
- **THEN** URL is `/chat/{chatId}?npcId={npcId}`
- **AND** npcId is used to fetch NPC data for features

#### Scenario: Direct chat link
- **WHEN** user shares or opens direct chat link
- **AND** npcId is missing from URL
- **THEN** system attempts to get npcId from chat document
- **AND** falls back gracefully if not found

### Requirement: Chat list accessible from navigation
The system SHALL provide easy access to chat list from main navigation.

#### Scenario: Navigation to chats
- **WHEN** user clicks "Chats" in navigation
- **THEN** user is taken to NPC list with "Chats" tab active

---

## MODIFIED Requirements

### Requirement: NPC list navigation updated for chat flow
The NPC list SHALL include chat actions in addition to existing NPC management features.

#### Scenario: Chat action prominent
- **WHEN** NPC list is displayed
- **THEN** primary action on NPC item is "Chat" button
- **AND** other actions (edit, fork, delete) are secondary
