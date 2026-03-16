## Why

The Aikami project needs to work with Firebase emulators for local development without requiring production credentials. Additionally, the chat functionality has schema validation issues that prevent messages from being saved and loaded correctly.

## What Changes

### Firebase Emulator Fixes

- Fixed Firestore "Component firestore has not been registered yet" error
- Fixed "No Firebase App '[DEFAULT]'" error
- Fixed module duplication between packages using static imports
- Added lazy initialization for Firestore
- Made GCLOUD_PROJECT optional in emulator mode
- Added PUBLIC_FLAVOR support to isEmulatorMode()
- Set default emulator hosts for Firebase Admin SDK

### Chat Fixes

- Updated TimestampSchema to accept Date objects
- Updated FieldValueSchema to recognize Firestore sentinels
- Fixed MessageSchema and ChatSchema for timestamps
- Added mock AI responses in emulator mode

### Tests

- Created chat-sending.spec.ts Playwright test

## Capabilities

### Modified Capabilities

- `firebase-integration`: Firebase emulators now work correctly in development mode
- `chat`: Chat messages can be sent and received (WIP: loading on refresh)

## Impact

- Files modified:
    - `packages/frontend/services/src/lib/firebase/configs/firestore.ts`
    - `packages/frontend/services/src/lib/firebase/configs/app.ts`
    - `packages/frontend/repositories/src/lib/base-frontend-repository.ts`
    - `packages/backend/configs/src/lib/environment.ts`
    - `packages/backend/configs/src/lib/app.ts`
    - `packages/backend/ai/src/lib/send-message.ts`
    - `packages/schemas/src/lib/fields.ts`
    - `packages/schemas/src/lib/core.ts`
    - `packages/schemas/src/lib/database/message.ts`
    - `packages/schemas/src/lib/database/npc-chat.ts`
    - `apps/frontend/pwa/src/lib/client/services/database/npc-chat.svelte.ts`
    - `apps/frontend/pwa/src/lib/client/services/chat/chat.svelte.ts`
    - `apps/frontend/pwa/tests/chat-sending.spec.ts`

## Pending

- Fix chat message loading on page refresh
- Fix chat message saving to Firestore
- Run and verify Playwright tests
- Run unit tests
