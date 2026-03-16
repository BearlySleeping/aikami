## ADDED Requirements

### Requirement: Chat displays NPC stats
The system SHALL display relevant DND stats for the NPC in the chat interface.

#### Scenario: Display NPC stats panel
- **WHEN** chat is loaded
- **THEN** NPC stats panel shows: HP, AC, Level, Class
- **AND** stats are collapsible/expandable

#### Scenario: Stats panel is accessible
- **WHEN** user clicks NPC avatar or stats icon
- **THEN** full stats panel expands
- **AND** shows detailed stats (abilities, saves, skills)

### Requirement: Chat displays affection/relationship system
The system SHALL track and display the user's relationship with the NPC (affection points).

#### Scenario: Display affection meter
- **WHEN** chat is loaded
- **THEN** affection meter is visible (hearts or progress bar)
- **AND** shows current affection value

#### Scenario: Affection changes from conversation
- **WHEN** NPC responds positively/negatively
- **THEN** affection value updates
- **AND** animation shows the change

#### Scenario: Affection level affects display
- **WHEN** affection is at different levels (hostile, neutral, friendly, romantic)
- **THEN** UI reflects the relationship (different colors, icons)

### Requirement: User can perform perception checks
The system SHALL allow users to roll perception checks during conversation.

#### Scenario: Roll perception check
- **WHEN** user clicks "Perception" button in chat
- **THEN** d20 + wisdom modifier is rolled
- **AND** result is displayed with total
- **AND** result is added to chat as system message

#### Scenario: Perception check with advantage/disadvantage
- **WHEN** user rolls perception with advantage
- **AND** user selects "Advantage" option
- **THEN** two d20s are rolled, higher is used

### Requirement: User can perform persuasion checks
The system SHALL allow users to roll persuasion checks to influence NPC.

#### Scenario: Roll persuasion check
- **WHEN** user clicks "Persuade" button
- **AND** enters what they want to persuade
- **THEN** d20 + charisma modifier is rolled
- **AND** result is displayed with total
- **AND** result is included in message to AI

#### Scenario: Persuasion affects NPC response
- **WHEN** persuasion check is rolled before message
- **THEN** the roll result is included in prompt to AI
- **AND** NPC response acknowledges the roll

### Requirement: User can generate background images
The system SHALL allow users to generate scene/background images based on chat context.

#### Scenario: Generate background image
- **WHEN** user clicks "Generate Background"
- **AND** enters scene description or uses current location
- **THEN** background image is generated
- **AND** applied to chat background

#### Scenario: Background in emulator mode
- **WHEN** user generates background in emulator
- **THEN** mock image is used
- **AND** "Demo Mode" indicator shown

### Requirement: Chat shows dice roll history
The system SHALL display a log of all dice rolls in the session.

#### Scenario: View roll history
- **WHEN** user clicks dice icon
- **THEN** roll history panel shows all rolls
- **AND** each roll shows: type, result, total, context
