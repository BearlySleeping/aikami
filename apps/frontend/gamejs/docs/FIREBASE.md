# Firebase Integration for GameJS

This document describes the Firebase integration for the GameJS Godot game.

## Overview

The game uses Firebase for backend services via REST APIs (not the Firebase SDK, since it runs in the Godot/JS runtime).

## Architecture

### Services

| Service | File | Description |
|---------|------|-------------|
| Env | `src/core/env.ts` | Environment configuration loader |
| Firebase | `src/core/firebase.ts` | Firebase configuration singleton |
| FirebaseHttpClient | `src/core/firebase_http_client.ts` | HTTP client using Godot's HTTPClient |
| FirebaseAuth | `src/core/firebase_auth.ts` | Authentication (email/password, anonymous) |
| FirebaseCloudSave | `src/core/firebase_cloud_save.ts` | Game save/load via Firestore |
| FirebaseLeaderboard | `src/core/firebase_leaderboard.ts` | Score leaderboard via Firestore |
| FirebaseStorage | `src/core/firebase_storage.ts` | File storage via Cloud Storage |
| FirebaseFunctions | `src/core/firebase_functions.ts` | Cloud Functions calls |

## Environment Configuration

Environment variables are loaded from `.env` file at runtime using Godot's FileAccess.

### Required Variables

```
PUBLIC_FIREBASE_API_KEY=your-api-key
PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
PUBLIC_FIREBASE_PROJECT_ID=your-project-id
PUBLIC_FLAVOR=DEVELOPMENT | EMULATOR | PRODUCTION
```

### Mode-Specific Endpoints

| Mode | Auth Endpoint | Firestore Endpoint | Functions Endpoint |
|------|---------------|-------------------|-------------------|
| EMULATOR | http://127.0.0.1:9099 | http://127.0.0.1:8080 | http://127.0.0.1:5001 |
| DEVELOPMENT | https://identitytoolkit.googleapis.com | https://firestore.googleapis.com | https://{region}-{project}.cloudfunctions.net |
| PRODUCTION | https://identitytoolkit.googleapis.com | https://firestore.googleapis.com | https://{region}-{project}.cloudfunctions.net |

## Usage

### Authentication

```typescript
import FirebaseAuth from '$core/firebase_auth';

// Sign in with email/password
const user = await FirebaseAuth.instance.sign_in_with_email(email, password);

// Sign up new user
const newUser = await FirebaseAuth.sign_up_with_email(email, password);

// Sign in anonymously
const anonUser = await FirebaseAuth.sign_in_anonymous();

// Get current user
const currentUser = FirebaseAuth.currentUser;
const isAuthenticated = FirebaseAuth.isAuthenticated;
```

### Cloud Save

```typescript
import FirebaseCloudSave from '$core/firebase_cloud_save';

// Save game
const saveData = {
  playerX: 100,
  playerY: 200,
  inventory: ['sword', 'shield'],
};
const saved = await FirebaseCloudSave.instance.save_game('level1', 5, 1000, saveData);

// Load game
const loaded = await FirebaseCloudSave.instance.load_game('level1');
if (loaded) {
  console.log(loaded.level, loaded.score, loaded.data);
}
```

### Leaderboard

```typescript
import FirebaseLeaderboard from '$core/firebase_leaderboard';

// Submit score
await FirebaseLeaderboard.instance.submit_score('arcade', userId, username, 5000);

// Fetch top scores
const entries = await FirebaseLeaderboard.instance.fetch_leaderboard('arcade', 10);
entries.forEach((entry, index) => {
  console.log(`${entry.rank}. ${entry.username}: ${entry.score}`);
});
```

### Storage

```typescript
import FirebaseStorage from '$core/firebase_storage';

// Upload file (base64 encoded)
const downloadUrl = await FirebaseStorage.instance.upload_file(
  'screenshots/score.png',
  base64Content,
  'image/png'
);

// Download file
const content = await FirebaseStorage.instance.download_file('savegame/data.json');

// Delete file
await FirebaseStorage.instance.delete_file('temp/cache.dat');
```

### Cloud Functions

```typescript
import FirebaseFunctions from '$core/firebase_functions';

// Call custom function
const result = await FirebaseFunctions.instance.call_function('myFunction', { data: 'value' });

// Convenience methods
const aiResult = await FirebaseFunctions.instance.prompt_ai('Generate a story', 'fantasy');
const imageResult = await FirebaseFunctions.instance.generate_image('a castle in the sky');
```

## Emulator Setup

### Starting Emulators

```bash
cd apps/frontend/gamejs
firebase emulators:start
```

### Available Emulator Ports

| Service | Port | REST API |
|---------|------|----------|
| Auth | 9099 | http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/ |
| Firestore | 8080 | http://127.0.0.1:8080/v1/projects/{project}/databases/(default)/documents |
| Storage | 8080 | http://127.0.0.1:8080/v1/b/{bucket}/o |
| Functions | 5001 | http://127.0.0.1:5001/{project}/{region}/{function} |

### Testing with Emulators

```bash
# Run test scene
bun run dev:emulator --scene=res://src/scenes/test/firebase_test.tscn

# Or use the test script
bun run scripts/debug.ts --mode=emulator --scene=res://src/scenes/test/firebase_test.tscn
```

## Debugging

### Enable Debug Logging

Set in `.env`:
```
PUBLIC_LOG_LEVEL=DEBUG
```

### Check Logs

All services use the `logger` from `$utils/logger`:
- `logger.debug()` - Debug messages
- `logger.info()` - Info messages
- `logger.warn()` - Warning messages
- `logger.error()` - Error messages

## Error Handling

All services return appropriate error types:
- `null` or empty arrays for not-found cases
- `false` for operation failures
- Error messages logged via logger

## Firestore Data Structure

### Game Saves
```
/games/{gameId}/saves/{uid}
  - uid: string
  - gameId: string
  - level: integer
  - score: integer
  - timestamp: timestamp
  - data: JSON string
```

### Leaderboard
```
/leaderboard/{gameId}/scores/{uid}
  - uid: string
  - username: string
  - score: integer
  - gameId: string
  - timestamp: timestamp
```

## Development Workflow

1. Create `.env.emulator` with Firebase project config
2. Start emulators: `firebase emulators:start`
3. Run game in emulator mode: `bun run dev:emulator`
4. Test services with test scene
5. Deploy to production when ready

## API Reference

See TypeScript source files for complete API documentation:
- `src/core/firebase*.ts` - All service implementations
- JSDoc comments for each method
