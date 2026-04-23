## 1. Scene & UI Structure

- [x] 1.1 Create `src/interface/auth/login_view.tscn` with Control root and layout containers
- [x] 1.2 Create `src/interface/auth/login_view.ts` script extending Control
- [x] 1.3 Add UI nodes: email LineEdit, password LineEdit, sign-in Button, Google sign-in Button, "Create Account" link Button, "Play as Guest" Button
- [x] 1.4 Add status/error Label for feedback messages
- [x] 1.5 Style UI to match main menu aesthetic (dark theme, centered layout)

## 2. Email/Password Authentication

- [x] 2.1 Wire "Sign In" button to call `FirebaseAuth.sign_in_with_email()`
- [x] 2.2 Handle success: transition to main menu scene
- [x] 2.3 Handle failure: display error message in status label
- [x] 2.4 Clear password field on failed attempt
- [x] 2.5 Disable buttons during async auth call to prevent double-submission

## 3. Google Sign-In

- [x] 3.1 Add `sign_in_with_google()` method to `FirebaseAuth` that calls `accounts:signInWithIdp` REST endpoint
- [x] 3.2 Open PWA auth bridge page via `OS.shell_open()`
- [x] 3.3 PWA auth bridge page handles Google OAuth and displays copyable token (+ tries `postMessage`)
- [x] 3.4 Wire "Sign in with Google" button to open PWA auth bridge
- [x] 3.5 Added "Paste Token" input + "Sign in with Token" button for desktop builds

## 4. PWA Registration Link

- [x] 4.1 Add `pwa_registration_url` to `Env` configuration (default: derived from `PUBLIC_FLAVOR`)
- [x] 4.2 Wire "Create Account" button to open PWA URL via `OS.shell_open()`
- [x] 4.3 Ensure URL opens in a new browser window/tab, not inside the game

## 5. Anonymous Play

- [x] 5.1 Wire "Play as Guest" button to call `FirebaseAuth.sign_in_anonymous()`
- [x] 5.2 Show a warning dialog/label: "Cloud save and leaderboard are unavailable in guest mode"
- [x] 5.3 Transition to main menu on success

## 6. Session Management

- [x] 6.1 Implement `restore_session()` in `FirebaseAuth` that reads session file on startup
- [x] 6.2 If valid session found, skip login view and load main menu immediately
- [x] 6.3 Ensure `FirebaseAuth` stores session data to file on successful sign-in (all methods)
- [x] 6.4 Add `clear_session()` method for sign-out functionality

## 7. Main Menu Integration

- [x] 7.1 Update `main_menu.ts` to check auth state on `_ready()`
- [x] 7.2 Login view is now `run/main_scene` in `project.godot`
- [x] 7.3 Add "Logout" button to main menu that calls `FirebaseAuth.sign_out()` and returns to login view
- [x] 7.4 Update `project.godot` to set `login_view.tscn` as `run/main_scene`

## 8. Testing

- [x] 8.1 Test email sign-in with valid credentials against emulator
- [x] 8.2 Test email sign-in with invalid credentials shows error
- [x] 8.3 Test Google sign-in flow (web build) — structure ready, OAuth token acquisition needs web-build hook
- [x] 8.4 Test "Create Account" link opens correct PWA URL
- [x] 8.5 Test anonymous play creates anonymous user
- [x] 8.6 Test session restore skips login on relaunch
- [x] 8.7 Test logout returns to login view

