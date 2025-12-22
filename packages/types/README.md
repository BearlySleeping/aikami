# Types

This package contains all the TypeScript types used across the Aikami project. These types are generated from the Zod schemas in the `@aikami/schemas` package, or are defined manually.

## Installation

This package is a dependency of other packages in the monorepo and is not meant to be used as a standalone package.

## Usage

To use the types from this package, import them from `@aikami/types`:

```typescript
import { User } from '@aikami/types'
```

## Types

This package is organized into the following categories:

- **API:** Types for the external APIs that the backend interacts with.
- **Backend:** Types for the backend services.
- **Common:** Types that are shared between the frontend and the backend.
- **Database:** Types for the Firestore database.
- **Form:** Types for the forms in the PWA.
- **PWA:** Types for the PWA.
- **Repository:** Types for the repositories.

### API

- `auth.ts`: Types for authentication-related APIs.
- `callable-functions.ts`: Types for the Firebase Callable Functions.
- `fcm.ts`: Types for the Firebase Cloud Messaging API.
- `firestore.ts`: Types for the Firestore API.
- `hubspot.ts`: Types for the HubSpot API.
- `microsoft.ts`: Types for the Microsoft API.
- `oauth2.ts`: Types for the OAuth2 API.

### Backend

- `auth.ts`: Types for the authentication service.
- `fcm.ts`: Types for the FCM service.
- `firebase.ts`: Types for the Firebase service.
- `firestorage.ts`: Types for the Firebase Storage service.
- `http.ts`: Types for the HTTP service.

### Common

- `preferences.ts`: Types for user preferences.

### Database

- `core.ts`: Core types for the database.
- `notification.ts`: Types for the notification documents.
- `oauth2.ts`: Types for the OAuth2 documents.
- `user.ts`: Types for the user documents.
- `persona.ts`: Types for the persona documents.
- `npc.ts`: Types for the NPC documents.
- `message.ts`: Types for the message documents.

### Form

- `auth.ts`: Types for the authentication forms.

### PWA

- `endpoints.ts`: Types for the PWA endpoints.
- `endpoint-auth.ts`: Types for the authentication endpoints.
- `endpoint-ai.ts`: Types for the AI endpoints.

### Repository

- `utils.ts`: Types for the repository utils.

### Other

- `auth.ts`: Various authentication-related types.
- `class.ts`: Types for classes.
- `common.ts`: Common types.
- `device.ts`: Types for devices.
- `error.ts`: Types for errors.
- `helpers.ts`: Types for helpers.
- `logger.ts`: Types for the logger.
