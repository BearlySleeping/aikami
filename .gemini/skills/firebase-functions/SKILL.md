---
name: firebase-functions
description: Best practices, patterns, and conventions for Firebase Cloud Functions development with TypeScript. Includes project structure, deployment, testing, and security rules.
version: 1.0.0
author: Aikami Team
tags: ["firebase", "cloud-functions", "serverless", "typescript", "gcp"]
---

# Firebase Cloud Functions Development Skill

This skill provides comprehensive guidelines for building Firebase Cloud Functions following the Aikami project's standards.

## 1. Project Structure

### Recommended Directory Structure

```
apps/backend/functions/
├── src/
│   ├── controllers/
│   │   ├── api/
│   │   │   ├── auth.ts
│   │   │   ├── chat.ts
│   │   │   └── ai.ts
│   │   └── index.ts
│   ├── lib/
│   │   ├── firestore.ts
│   │   ├── auth.ts
│   │   └── storage.ts
│   ├── utils/
│   │   ├── logger.ts
│   │   └── validators.ts
│   ├── types/
│   │   └── index.ts
│   └── index.ts           # Main entry point
├── scripts/
│   ├── populate-npcs.ts
│   ├── bucket.ts
│   └── project-init.ts
├── tests/
│   └── functions/
├── package.json
├── tsconfig.json
├── deploy.ts              # Deployment script
└── compile.ts             # Compilation script
```

---

## 2. Function Types

### HTTP Functions

```typescript
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

/**
 * HTTP function handler for AI requests.
 * Processes incoming AI-related requests.
 */
export const handleAIRequest = onRequest(
  {
    region: 'us-central1',
    cors: true,
  },
  async (req, res) => {
    logger.info('AI request received', { method: req.method });
    
    try {
      const { payload, type } = req.body;
      
      // Process request
      const result = await processRequest(type, payload);
      
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('AI request failed', { error });
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  }
);
```

### Callable Functions

```typescript
import { onCall, region } from 'firebase-functions/v2/https';

/**
 * Callable function for user authentication.
 * Handles login, register, and session management.
 */
export const handleAuth = region('us-central1').onCall(
  async (data, context) => {
    // context.auth contains authenticated user info
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated'
      );
    }
    
    const { action, payload } = data;
    
    switch (action) {
      case 'getProfile':
        return { uid: context.auth.uid, email: context.auth.token.email };
      default:
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Unknown action'
        );
    }
  }
);
```

### Scheduled Functions

```typescript
import { onSchedule } from 'firebase-functions/v2/scheduler';

/**
 * Daily cleanup function.
 * Runs every day at midnight.
 */
export const dailyCleanup = onSchedule({
  schedule: '0 0 * * *',
  region: 'us-central1',
  timeZone: 'America/New_York',
}, async (event) => {
  logger.info('Running daily cleanup');
  
  // Cleanup logic
  const deletedCount = await cleanupOldData();
  
  logger.info(`Cleanup complete. Deleted ${deletedCount} records`);
});
```

### Firestore Triggers

```typescript
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore';

/**
 * Triggered when a new character is created.
 * Initializes default character data.
 */
export const onCharacterCreated = onDocumentCreated(
  {
    document: 'characters/{characterId}',
    region: 'us-central1',
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    
    const characterData = snapshot.data();
    
    // Initialize default fields
    await snapshot.ref.set({
      ...characterData,
      createdAt: FieldValue.serverTimestamp(),
      stats: {
        level: 1,
        experience: 0,
      },
    }, { merge: true });
  }
);
```

---

## 3. Authentication

### User Authentication Middleware

```typescript
import { auth } from 'firebase-admin';

/**
 * Validates the authentication token from request headers.
 * @param authHeader - The Authorization header value
 * @returns The decoded token
 * @throws HttpsError if invalid
 */
export async function validateAuth(authHeader: string | undefined) {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Missing or invalid authorization header'
    );
  }
  
  const token = authHeader.slice(7);
  
  try {
    const decodedToken = await auth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Invalid token'
    );
  }
}
```

### Role-Based Access

```typescript
/**
 * User roles for access control
 */
type UserRole = 'admin' | 'moderator' | 'user' | 'guest';

/**
 * Checks if user has required role.
 * @param userRoles - User's assignedparam requiredRole - roles
 * @ Role required for access
 */
export function hasRole(userRoles: UserRole[], requiredRole: UserRole): boolean {
  const roleHierarchy: Record<UserRole, number> = {
    guest: 0,
    user: 1,
    moderator: 2,
    admin: 3,
  };
  
  return userRoles.some(role => 
    roleHierarchy[role] >= roleHierarchy[requiredRole]
  );
}
```

---

## 4. Database Operations

### Firestore Helpers

```typescript
import { firestore, FieldValue } from 'firebase-admin';

/**
 * Creates a new document in a collection.
 * @param collectionName - Name of the collection
 * @param data - Document data
 * @returns Created document reference
 */
export async function createDocument<T extends Record<string, unknown>>(
  collectionName: string,
  data: T
): Promise<firestore.DocumentReference> {
  const docRef = firestore().collection(collectionName).doc();
  
  await docRef.set({
    ...data,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  
  return docRef;
}

/**
 * Updates a document with validation.
 * @param collectionName - Collection name
 * @param docId - Document ID
 * @param data - Update data
 */
export async function updateDocument(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>
): Promise<void> {
  const docRef = firestore().collection(collectionName).doc(docId);
  
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new functions.https.HttpsError('not-found', 'Document not found');
  }
  
  await docRef.update({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
```

---

## 5. Error Handling

### Standardized Error Responses

```typescript
import { logger } from 'firebase-functions';

/**
 * Firebase Functions error types
 */
type ErrorCode = 
  | 'ok'
  | 'cancelled'
  | 'unknown'
  | 'invalid-argument'
  | 'deadline-exceeded'
  | 'not-found'
  | 'already-exists'
  | 'permission-denied'
  | 'resource-exhausted'
  | 'failed-precondition'
  | 'aborted'
  | 'out-of-range'
  | 'unimplemented'
  | 'internal'
  | 'unavailable'
  | 'data-loss'
  | 'unauthenticated';

/**
 * Throws a typed Firebase Functions error.
 * @param code - Error code
 * @param message - Error message
 * @param details - Optional details
 */
export function throwError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): never {
  logger.error(`[${code}] ${message}`, details);
  throw new functions.https.HttpsError(code, message, details);
}
```

---

## 6. Testing

### Unit Testing Functions

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleAIRequest } from '../src/controllers/api/ai';

// Mock Firebase Admin
vi.mock('firebase-admin', () => ({
  firestore: vi.fn(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn(),
        set: vi.fn(),
        update: vi.fn(),
      })),
    })),
  })),
  auth: vi.fn(),
}));

describe('handleAIRequest', () => {
  it('should process valid request', async () => {
    const mockReq = {
      body: { type: 'chat', payload: { message: 'Hello' } },
    } as any;
    
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    
    await handleAIRequest(mockReq, mockRes);
    
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });
});
```

### Integration Testing

```typescript
import { test, expect } from '@playwright/test';

test.describe('Cloud Functions API', () => {
  test('should authenticate user', async ({ request }) => {
    const response = await request.post('https://us-central1-project.cloudfunctions.net/handleAuth', {
      data: {
        action: 'getProfile',
      },
      headers: {
        Authorization: 'Bearer mock-token',
      },
    });
    
    expect(response.ok()).toBeTruthy();
  });
});
```

---

## 7. Deployment

### Deployment Script

```typescript
// deploy.ts
import { execSync } from 'child_process';

/**
 * Deploys Firebase functions to specified environment.
 * @param environment - 'staging' or 'production'
 */
export async function deploy(environment: 'staging' | 'production') {
  const project = `aikami-${environment}`;
  
  console.log(`Deploying to ${project}...`);
  
  try {
    // Set project
    execSync(`firebase use ${project}`, { stdio: 'inherit' });
    
    // Deploy functions
    execSync('firebase deploy --only functions', { stdio: 'inherit' });
    
    console.log(`Successfully deployed to ${project}`);
  } catch (error) {
    console.error('Deployment failed:', error);
    process.exit(1);
  }
}
```

### Commands

```bash
# Deploy all
bun run deploy

# Deploy to staging
bun run deploy:staging

# Deploy to production
bun run deploy:prod

# Run functions locally
bun run functions:serve

# View function logs
firebase functions:log

# Test function locally
firebase emulators:start
```

---

## 8. Security Rules

### Firestore Rules

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return request.auth.uid == userId;
    }
    
    function isAdmin() {
      return request.auth.token.admin == true;
    }
    
    // User profiles
    match /users/{userId} {
      allow read: if isAuthenticated();
      allow write: if isOwner(userId) || isAdmin();
    }
    
    // Characters
    match /characters/{characterId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated();
      allow update, delete: if isOwner(resource.data.ownerId) || isAdmin();
    }
  }
}
```

---

## 9. Environment Configuration

### Environment Variables

```typescript
// Environment configuration
interface EnvironmentConfig {
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  DATABASE_URL: string;
  FIREBASE_PROJECT_ID: string;
}

/**
 * Gets environment configuration.
 * Throws error if required vars are missing.
 */
export function getEnvConfig(): EnvironmentConfig {
  const required = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
    DATABASE_URL: process.env.DATABASE_URL || '',
    FIREBASE_PROJECT_ID: process.env.GCLOUD_PROJECT || '',
  };
}
```

---

## 10. Best Practices

### 1. Cold Start Optimization

```typescript
// Initialize heavy dependencies outside function
import { AIProvider } from './lib/ai-provider';

const aiProvider = new AIProvider();

export const processAI = onRequest(async (req, res) => {
  // aiProvider is already initialized
  const result = await aiProvider.generate(req.body.prompt);
  res.json({ result });
});
```

### 2. Rate Limiting

```typescript
import { onRequest } from 'firebase-functions/v2/https';

/**
 * Rate limiter configuration
 */
const rateLimiter = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
};

export const rateLimitedFunction = onRequest({
  cors: true,
  rateLimits: rateLimiter,
}, async (req, res) => {
  // Function logic
});
```

### 3. Retry Logic

```typescript
export const robustFunction = onRequest({
  retry: true, // Enable retry on failure
}, async (req, res) => {
  // Function logic with automatic retry
});
```

---

## 11. Anti-Patterns to Avoid

1. ❌ Initializing heavy dependencies inside the function (increases cold start)
2. ❌ Not handling errors (unhandled errors cause function crashes)
3. ❌ Using synchronous operations (blocks execution)
4. ❌ Storing secrets in function code (use environment variables)
5. ❌ Not setting proper timeouts (default is 60s, max 540s)
6. ❌ Making too many concurrent database calls (use batching)
7. ❌ Not using retry policies for critical functions
