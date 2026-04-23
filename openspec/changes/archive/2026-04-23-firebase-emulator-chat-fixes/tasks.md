# Tasks

## Completed

- [x] Fix Firebase Firestore "Component firestore has not been registered yet" error
- [x] Fix "No Firebase App '[DEFAULT]'" error
- [x] Fix module duplication between packages (static imports)
- [x] Add lazy initialization for Firestore
- [x] Make GCLOUD_PROJECT optional in emulator mode
- [x] Add PUBLIC_FLAVOR support to isEmulatorMode()
- [x] Set default emulator hosts for Firebase Admin SDK
- [x] Fix Persona Creation UX
- [x] Update TimestampSchema to accept Date objects
- [x] Update FieldValueSchema to recognize Firestore sentinels
- [x] Fix MessageSchema and ChatSchema for timestamps
- [x] Add mock AI responses in emulator mode
- [x] Create chat-sending.spec.ts Playwright test

## Completed

- [x] Fix chat message loading on page refresh
- [x] Fix chat message saving to Firestore
- [x] Fix unit test setup (exclude RisuAI examples, fix game-state-service.test.ts)
- [x] Create flake.nix for Playwright browser dependencies

## Pending

- [ ] Run and verify Playwright tests (use `nix develop` with new flake.nix)
- [ ] Test persona creation flow end-to-end
