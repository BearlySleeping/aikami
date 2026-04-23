## Why

The GameJS project needs a proper authentication flow so players can sign in before accessing cloud save, leaderboards, and multiplayer features. Instead of duplicating registration logic in Godot, we should leverage the existing SvelteKit PWA for account creation while keeping the login experience native to the game.

## What Changes

- Create a new `AuthLoginView` scene in GodotJS with email/password login form
- Add "Sign in with Google" button using Firebase Authentication
- Add "Create Account" link that opens the SvelteKit PWA registration page in a browser/external window
- Integrate with existing `FirebaseAuth` service (`firebase_auth.ts`) for sign-in operations
- Add session persistence via `localStorage` so returning players stay logged in
- Wire the login view into the main menu flow (show login if no active session)

## Capabilities

### New Capabilities
- `gamejs-auth-login`: GodotJS authentication UI with email/password and Google sign-in, delegating registration to the SvelteKit PWA

### Modified Capabilities
- None

## Impact

- **Frontend**: New GodotJS scene (`src/interface/auth/login_view.tscn` + `.ts`)
- **Backend**: No changes — uses existing Firebase Auth emulator/production endpoints
- **PWA**: SvelteKit registration page URL must be configurable (already supported via `Env` config)
- **Dependencies**: Reuses existing `FirebaseAuth`, `FirebaseHttpClient`, and `Env` autoloads

