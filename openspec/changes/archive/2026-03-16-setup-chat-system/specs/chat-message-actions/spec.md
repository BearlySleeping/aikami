## ADDED Requirements

### Requirement: User can edit their own messages
The system SHALL allow users to edit messages they have sent. Edited messages SHALL show an indicator and preserve edit history.

#### Scenario: Edit user message
- **WHEN** user clicks edit button on their message
- **THEN** message text becomes editable
- **AND** save/cancel buttons appear
- **AND** after saving, `editedAt` timestamp is set

#### Scenario: Edit AI message
- **WHEN** user clicks edit button on AI message
- **THEN** user can modify the AI response
- **AND** modified text is marked as user-edited

#### Scenario: Cancel edit
- **WHEN** user clicks cancel during edit
- **THEN** original message text is restored
- **AND** no changes are saved

### Requirement: User can delete messages
The system SHALL allow users to delete their own messages. Deleted messages SHALL be removed from Firestore and UI.

#### Scenario: Delete user message
- **WHEN** user clicks delete on their message
- **THEN** confirmation dialog appears
- **AND** on confirm, message is removed from Firestore and UI

#### Scenario: Delete AI message
- **WHEN** user clicks delete on AI message
- **THEN** message is removed from Firestore and UI

### Requirement: User can regenerate AI response
The system SHALL allow users to regenerate the last AI response by deleting it and requesting a new one.

#### Scenario: Regenerate AI message
- **WHEN** user clicks regenerate button on AI message
- **AND** this is the last AI message in the conversation
- **THEN** the message is deleted
- **AND** a new AI response is generated
- **AND** the new response replaces the old one

#### Scenario: Cannot regenerate non-last AI message
- **WHEN** user clicks regenerate on AI message that is not the last
- **THEN** the button is disabled or shows warning
- **AND** regeneration does not proceed

### Requirement: Deleted messages show placeholder
The system SHALL show a placeholder for deleted messages rather than removing them entirely, to maintain conversation flow.

#### Scenario: View deleted message
- **WHEN** a message has been deleted
- **THEN** placeholder text shows "[Message deleted]"
- **AND** edit/delete buttons are hidden
