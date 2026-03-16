## Why

Aikami needs a polished, DND/JJRG-focused chat experience that goes beyond basic messaging. Users want rich interactions with NPCs including message editing, image generation, TTS narration, file embeds, and RPG mechanics like perception/persuasion checks. The current chat system lacks these features and doesn't properly integrate with the NPC list for seamless chat creation.

## What Changes

- **New Chat System**: Full-featured chat UI with Firestore storage, message management, and NPC integration
- **Message Actions**: Edit, delete, regenerate AI responses
- **Rich Media**: Image generation with mock in emulator, TTS narration with mock in emulator, file/image embedding
- **RPG Features**: Stats display, affection system, perception checks, persuasion checks, background image generation
- **Navigation Flow**: Click NPC in list → create new chat or use existing → navigate to chat page
- **SSR Enhancement**: Server-side fetch of chat and NPC data with proper state passing to view model

## Capabilities

### New Capabilities
- `chat-messaging`: Full chat system with Firestore persistence, message CRUD, and streaming responses
- `chat-message-actions`: Edit, delete, and regenerate individual messages
- `chat-media`: Image generation, TTS narration, file/image embedding in messages
- `chat-rpg-mechanics`: Stats display, affection system, dice rolls (perception, persuasion checks)
- `npc-chat-integration`: NPC list click creates/opens chat, navigates to chat page
- `chat-ssr`: Server-side rendering of chat and NPC data

### Modified Capabilities
- `npc-list`: Add chat creation flow when clicking an NPC
- `npc-data`: Extend with chat-specific fields (affection, stats)

## Impact

- **Frontend**: New chat view components, updated NPC list, view model changes
- **Backend**: New Firestore functions for message CRUD, image/TTS services with emulator mocks
- **Database**: Updated chat/message schemas with new fields for actions and RPG data
- **Services**: New AI services for image generation, TTS (mocked in emulator)
