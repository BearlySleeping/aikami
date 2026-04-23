## ADDED Requirements

### Requirement: Player can sign in with email and password
The system SHALL display a login form with email and password fields and a "Sign In" button. Upon submission, the system SHALL authenticate the player via the existing `FirebaseAuth` service and transition to the main menu on success.

#### Scenario: Successful email/password sign-in
- **WHEN** player enters valid email and password and clicks "Sign In"
- **THEN** the system calls `FirebaseAuth.sign_in_with_email()`
- **THEN** the main menu becomes visible

#### Scenario: Failed email/password sign-in
- **WHEN** player enters invalid credentials and clicks "Sign In"
- **THEN** the system displays an error message without crashing

### Requirement: Player can sign in with Google
The system SHALL provide a "Sign in with Google" button. When clicked, the system SHALL open a browser window for Google OAuth, obtain an `id_token`, and authenticate the player via Firebase `accounts:signInWithIdp`.

#### Scenario: Successful Google sign-in
- **WHEN** player clicks "Sign in with Google"
- **THEN** the system opens a Google OAuth consent screen
- **THEN** upon receiving the `id_token`, the system calls Firebase `signInWithIdp`
- **THEN** the player is authenticated and the main menu becomes visible

### Requirement: Player can navigate to SvelteKit PWA for registration
The system SHALL display a "Create Account" link that opens the SvelteKit PWA registration page in an external browser window.

#### Scenario: Opening registration page
- **WHEN** player clicks "Create Account"
- **THEN** the system opens the configured PWA registration URL in the default browser

### Requirement: Player can skip authentication and play anonymously
The system SHALL provide a "Play as Guest" button that signs the player in anonymously via `FirebaseAuth.sign_in_anonymous()`.

#### Scenario: Anonymous play
- **WHEN** player clicks "Play as Guest"
- **THEN** the system creates an anonymous Firebase session
- **THEN** the main menu becomes visible
- **THEN** a warning is shown that cloud features are limited

### Requirement: Session is restored automatically on launch
The system SHALL check for an existing auth session on login view initialization. If a valid session exists, the system SHALL skip the login view and show the main menu directly.

#### Scenario: Existing session
- **WHEN** the login view initializes
- **THEN** the system checks `localStorage` for a stored auth token
- **THEN** if a token is found and valid, the main menu is shown immediately

### Requirement: Login view integrates with main menu flow
The system SHALL show the login view before the main menu if no valid session exists. After successful authentication (any method), the system SHALL transition to the main menu.

#### Scenario: Login → Main Menu flow
- **WHEN** the game launches with no existing session
- **THEN** the login view is displayed
- **THEN** after successful sign-in, the main menu is displayed
