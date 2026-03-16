## ADDED Requirements

### Requirement: User can send messages to NPC
The system SHALL allow users to send text messages to an NPC in a chat session. The message SHALL be persisted to Firestore and displayed in the chat interface.

#### Scenario: Send message successfully
- **WHEN** user types a message and presses send
- **THEN** the message is saved to Firestore with sender='user', timestamp, and appears in the chat
- **AND** the AI response is requested and displayed

#### Scenario: Send message while AI is responding
- **WHEN** user tries to send a message while `isTyping` is true
- **THEN** the send button is disabled
- **AND** the message is not sent

### Requirement: Chat loads previous messages on page load
The system SHALL load all messages from the chat session when the page loads, preserving conversation history.

#### Scenario: Load existing chat
- **WHEN** user navigates to a chat with existing messages
- **THEN** all messages are fetched from Firestore
- **AND** displayed in chronological order (oldest first)
- **AND** loading indicator shows while fetching

#### Scenario: Empty chat
- **WHEN** user navigates to a new chat with no messages
- **THEN** greeting card is displayed
- **AND** "Start Chat" button initiates the first message

### Requirement: Chat displays streaming AI response
The system SHALL display AI responses as they are generated, with a typing indicator while waiting.

#### Scenario: AI is generating response
- **WHEN** AI is generating a response
- **THEN** "NPC is typing..." indicator is displayed
- **AND** message appears incrementally as chunks arrive

### Requirement: User can view NPC info in chat
The system SHALL display the NPC's avatar, name, and relevant info in the chat header.

#### Scenario: Chat header displays NPC info
- **WHEN** chat is loaded
- **THEN** NPC name, avatar (if available), and character class/level are displayed in header

---

## MODIFIED Requirements

### Requirement: Message schema updated for chat features
The message schema SHALL include additional fields to support editing, attachments, and metadata.

#### Scenario: Message with edit tracking
- **WHEN** a message is edited
- **THEN** `editedAt` timestamp is set
- **AND** `editedBy` indicates who edited ('user' or 'ai')

#### Scenario: Message with attachments
- **WHEN** a message has an image or file attachment
- **AND** the attachment is stored in the `attachments` array
- **THEN** the attachment is rendered in the message bubble
