# Proposal: GameJS Firebase Integration

## Summary

Integrate Firebase with GodotJS game for backend features (auth, save data, leaderboards).

## Problem

Game needs backend for:
- User authentication
- Save progress to cloud
- Leaderboards
- In-app purchases validation

## Constraints

- GodotJS runs in browser, not Node.js
- NPM packages may not work directly (see godotjs docs on npm dependencies)
- Options: use Firebase REST API directly OR GodotFirebase (godot-nuts) OR implement manually

## Solution Options

### Option A: Firebase REST API (Recommended)
Use Firebase REST endpoints directly from TypeScript:
- Auth: `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken`
- Firestore: `POST https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents`
- Pros: Standard, well-documented
- Cons: Need custom token for auth

### Option B: GodotFirebase
Use https://github.com/GodotNuts/GodotFirebase
- Godot-native Firebase SDK
- Pros: Designed for Godot
- Cons: May have compatibility issues

### Option C: Custom Implementation
Create own save/load via HTTP requests to Cloud Functions
- Most control
- Most work to implement

## Success Criteria

- [ ] User can sign in (anonymous or email)
- [ ] Game progress saves to cloud
- [ ] Leaderboard displays scores
- [ ] Works in web build