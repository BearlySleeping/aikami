# @app/backend-rules

Security rules for Firebase Firestore and Cloud Storage.

## Overview

This app contains Firebase security rules for:
- Firestore database rules
- Cloud Storage rules
- Firestore indexes configuration

## Tech Stack

- **Platform**: Firebase
- **Language**: Firebase Rules DSL

## Installation

This is a workspace app managed by moon. Install dependencies:

```bash
bun install
```

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `lint` | `bun run lint` | Lint rules with Biome |
| `format` | `bun run format` | Format code with Biome |
| `check` | `bun run check` | Run type checks |

## Dependencies

This app depends on the following packages:
- `@aikami/constants`
- `@aikami/schemas`
- `@aikami/types`
- `@aikami/logger`
- `@aikami/backend-configs`
- `@aikami/backend-utils`

## Rules Files

- `firestore.rules` - Firestore security rules
- `firestore.indexes.json` - Firestore index definitions
- `storage.rules` - Cloud Storage security rules

## Deployment

```bash
firebase deploy --only firestore:rules,storage
```
