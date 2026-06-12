# @aikami/firebase

Backend cloud functions deployed to Firebase Cloud Functions.

## Overview

This app contains the Firebase Cloud Functions for the Aikami project:
- HTTP-triggered API endpoints
- Scheduled jobs
- Event-triggered functions
- AI-powered features with Genkit

## Tech Stack

- **Runtime**: Node.js / Bun
- **Platform**: Firebase Cloud Functions
- **AI**: Google Genkit

## Installation

This is a workspace app managed by moon. Install dependencies:

```bash
bun install
```

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `build` | `bun run build` | Compile TypeScript for deployment |
| `deploy` | `bun run deploy` | Deploy functions to Firebase |
| `typecheck` | `tsgo --noEmit --skipLibCheck` | Run TypeScript type checking |
| `lint` | `biome lint .` | Lint code with Biome |
| `format` | `biome format .` | Format code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |
| `test` | `bun test tests/controllers.test.ts` | Run function tests |

## Dependencies

This app depends on the following packages:
- `@aikami/constants`
- `@aikami/schemas`
- `@aikami/types`
- `@aikami/logger`
- `@aikami/backend-configs`
- `@aikami/backend-utils`
- `@aikami/backend-database`

## Deployment

```bash
# Build and deploy
moon run functions:deploy

# Or manually
bun run build && firebase deploy --only functions
```

## Function Structure

```
src/
└── controllers/
    └── api/       # HTTP-triggered functions
scripts/           # Utility scripts for data management
```
