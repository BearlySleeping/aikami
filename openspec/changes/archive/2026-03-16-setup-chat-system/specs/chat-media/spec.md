## ADDED Requirements

### Requirement: User can generate images from message context
The system SHALL allow users to generate images based on the current chat context. In emulator mode, this returns mock data.

#### Scenario: Generate image from chat
- **WHEN** user clicks generate image button
- **AND** enters a prompt (or uses auto-generated prompt from context)
- **THEN** image generation request is sent
- **AND** loading indicator shows during generation
- **AND** generated image is displayed in chat as message attachment

#### Scenario: Emulator mode image generation
- **WHEN** user generates image while in emulator mode
- **THEN** mock image URL is returned
- **AND** "Demo Mode" indicator is displayed

#### Scenario: Image generation failure
- **WHEN** image generation fails
- **THEN** error message is displayed
- **AND** user can retry

### Requirement: User can hear NPC messages via TTS
The system SHALL allow users to hear NPC messages read aloud using TTS. In emulator mode, this returns mock audio.

#### Scenario: Play TTS for AI message
- **WHEN** user clicks TTS play button on AI message
- **AND** NPC has voice config
- **THEN** audio plays the message text
- **AND** play button becomes pause button during playback

#### Scenario: Emulator mode TTS
- **WHEN** user plays TTS while in emulator mode
- **THEN** mock audio URL is returned
- **AND** "Demo Mode" indicator is displayed

#### Scenario: TTS without voice config
- **WHEN** user clicks TTS but NPC has no voice config
- **THEN** default voice is used
- **OR** warning message is shown

### Requirement: User can embed images in messages
The system SHALL allow users to attach images to their messages, either from file upload or URL.

#### Scenario: Attach image from file
- **WHEN** user clicks attach image button
- **AND** selects an image file
- **THEN** image is uploaded to storage
- **AND** thumbnail is shown in message input
- **AND** image is sent with the message

#### Scenario: Attach image from URL
- **WHEN** user pastes image URL in message
- **AND** URL is valid image
- **THEN** image preview is shown
- **AND** image is embedded in sent message

### Requirement: User can attach files to messages
The system SHALL allow users to attach files to messages for reference.

#### Scenario: Attach file to message
- **WHEN** user clicks attach file button
- **AND** selects a file
- **THEN** file is uploaded to storage
- **AND** file name is shown in message
- **AND** file can be downloaded by recipient
