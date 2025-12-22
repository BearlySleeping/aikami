# Schemas

This package contains all the Zod schemas used across the Aikami project. These schemas are used for validating data at runtime, and for generating TypeScript types.

## Installation

This package is a dependency of other packages in the monorepo and is not meant to be used as a standalone package.

## Usage

To use the schemas from this package, import them from `@aikami/schemas`:

```typescript
import { FCMPlatformSchema } from '@aikami/schemas'
```

## Schemas

### API

#### `fcm.ts`

- `FCMPlatformSchema`: A Zod schema for validating FCM platforms.
  - `android`
  - `ios`
  - `web`

#### `oauth.ts`

- `OAuthRequestSchema`: A Zod schema for validating OAuth requests.
- `OAuthResponseSchema`: A Zod schema for validating OAuth responses.

### Form

#### `auth.ts`

- `SignInWithPasswordSchema`: A Zod schema for validating sign-in with password forms.
- `SignUpWithPasswordSchema`: A Zod schema for validating sign-up with password forms.
- `ForgotPasswordSchema`: A Zod schema for validating forgot password forms.
- `UpdatePasswordSchema`: A Zod schema for validating update password forms.

### Database

#### `notification.ts`

- `NotificationSchema`: A Zod schema for validating notification documents in Firestore.

#### `user.ts`

- `UserSchema`: A Zod schema for validating user documents in Firestore.

#### `message.ts`

- `MessageSchema`: A Zod schema for validating message documents in Firestore.

#### `character.ts`

- `CharacterSchema`: A Zod schema for validating character documents in Firestore.

#### `persona.ts`

- `PersonaSchema`: A Zod schema for validating persona documents in Firestore.

#### `npc.ts`

- `NPCSchema`: A Zod schema for validating NPC documents in Firestore.

### Common

#### `preference.ts`

- `PreferenceSchema`: A Zod schema for validating user preference objects.

#### `position.ts`

- `PositionSchema`: A Zod schema for validating position objects.

### Other

- `auth.ts`: Contains various authentication-related schemas.
- `core.ts`: Contains core schemas that are used in other schemas.
- `fields.ts`: Contains reusable field schemas.
