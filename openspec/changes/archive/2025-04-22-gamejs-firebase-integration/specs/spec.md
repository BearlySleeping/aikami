## ADDED Requirements

### Requirement: Anonymous Authentication
The system SHALL allow users to sign in anonymously for quick access without providing credentials.

#### Scenario: First launch anonymous sign-in
- **WHEN** user launches game for the first time
- **THEN** system creates anonymous user account
- **AND** stores user ID in local storage for future sessions

#### Scenario: Returning anonymous user
- **WHEN** user returns with stored anonymous credentials
- **THEN** system restores their previous session

### Requirement: Email/Password Authentication
The system SHALL allow users to register and sign in with email and password.

#### Scenario: User registers with email
- **WHEN** user provides email and password
- **THEN** system creates user account in Firebase Auth

#### Scenario: User signs in with email
- **WHEN** user provides matching email and password
- **THEN** system authenticates user and loads their data

### Requirement: Cloud Save
The system SHALL save and load user game progress to/from Firebase Firestore.

#### Scenario: Save game progress
- **WHEN** user completes a level or save point
- **THEN** system saves progress to Firestore
- **AND** shows save confirmation

#### Scenario: Load game progress
- **WHEN** user loads a saved game
- **THEN** system retrieves progress from Firestore
- **AND** restores game state

### Requirement: Leaderboard
The system SHALL display a leaderboard showing top scores.

#### Scenario: Submit score
- **WHEN** user completes a game session with a score
- **THEN** system submits score to leaderboard

#### Scenario: View leaderboard
- **WHEN** user opens leaderboard
- **THEN** system displays top 10 scores from Firestore

### Requirement: Web Build Compatibility
All Firebase features SHALL work in the browser export (HTML5/WebGL).

#### Scenario: Firebase calls in web build
- **WHEN** game runs in web browser
- **THEN** all HTTP calls to Firebase REST API work correctly