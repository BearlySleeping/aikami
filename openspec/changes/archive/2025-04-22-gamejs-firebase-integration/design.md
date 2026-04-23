## Context

The GameJS game needs backend features but runs in browser via GodotJS. We need to integrate Firebase for:
- User authentication (anonymous + email)
- Cloud save (game progress sync)
- Leaderboards

Firebase SDKs don't work directly in GodotJS browser export, so we'll use Firebase REST API.

## Goals / Non-Goals

**Goals:**
- Anonymous auth for quick start
- Email/password auth for persistent accounts
- Save game progress to Firestore
- Display leaderboard from Firestore

**Non-Goals:**
- Real-time multiplayer
- In-app purchase validation (future task)
- Cloud Functions (use Firestore directly)

## Decisions

### D1: Firebase REST API over SDK
We use Firebase REST API because:
- No SDK dependencies needed
- Works in browser export
- Standard Firebase API

### D2: Auth Flow
1. Try anonymous auth on first launch
2. Store user ID in localStorage
3. Allow upgrade to email/password

### D3: Data Storage
Using Firestore:
- `users/{userId}` - user profile
- `games/{gameId}/saves/{saveId}` - game saves
- `leaderboard/{gameId}` - scores

### D4: API Calls via GameJS HTTP
Create HTTP client service using Godot's HTTPRequest nodes to call Firebase REST endpoints.

## Risks / Trade-offs

[R1 Custom token required for Firebase Auth] → Use Firebase Admin SDK in Cloud Functions to mint tokens, or use email/password auth directly

[R2 No real-time SDK] → Poll Firestore for updates or use manual refresh

[R3 CORS issues] → Use Firebase Auth REST (no CORS) + Cloud Functions for Firestore

## Migration Plan

1. Create FirebaseHttpClient service
2. Implement auth endpoints
3. Implement save/load for game state
4. Implement leaderboard fetch
5. Test in web export