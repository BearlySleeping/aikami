# `/firestack create <type> <name>`

Scaffold new Cloud Functions. The agent creates the file, writes the boilerplate, and optionally runs a build check.

## When to Use

- User says "create a function", "add an endpoint", "new API route", "add a firestore trigger"
- User invokes `/firestack create api hello` or `/firestack create firestore users/[uid] created`

## Workflow

### Step 1: Determine Type and Path

Parse the command:
- `create api <name>` → HTTP function in `api/<name>.ts`
- `create callable <name>` → Callable function in `callable/<name>.ts`
- `create firestore <path> <event>` → Firestore trigger in `firestore/<path>/<event>.ts`
- `create auth <event>` → Auth trigger in `auth/<event>.ts`
- `create scheduler <name>` → Scheduled function in `scheduler/<name>.ts`
- `create storage <event>` → Storage trigger in `storage/<event>.ts`
- `create database <ref> <event>` → RTDB trigger in `database/<ref>/<event>.ts`

Read `firestack.json` to get `functionsDirectory` (default: `src/controllers`).

### Step 2: Check for Conflicts

Verify the target file does not already exist. If it does, ask the user if they want to overwrite.

### Step 3: Generate the File

Use the templates below. Always use `@snorreks/firestack` imports.

---

### Template: HTTP (`api/<name>.ts`)

```typescript
import { onRequest } from '@snorreks/firestack';

export default onRequest(
  (request, response) => {
    response.send({ message: 'Hello from {{name}}!' });
  },
  {
    region: 'us-central1',
    memory: '256MiB',
  }
);
```

### Template: HTTP with Params (`api/<name>/[id].ts`)

```typescript
import { onRequest } from '@snorreks/firestack';

export default onRequest(
  (request, response) => {
    const id = request.params.id;
    response.send({ id, message: `Resource ${id}` });
  },
  {
    region: 'us-central1',
  }
);
```

### Template: HTTP with Zod Validation (`api/<name>.ts`)

```typescript
import { onRequestZod } from '@snorreks/firestack';
import { z } from 'zod';

const BodySchema = z.object({
  message: z.string().min(1),
});

export default onRequestZod(
  BodySchema,
  (request, response) => {
    response.send({ received: request.body.message });
  }
);
```

### Template: Callable (`callable/<name>.ts`)

```typescript
import { onCall } from '@snorreks/firestack';

export default onCall(({ data, auth }) => {
  console.log(`Called by ${auth?.uid} with:`, data);
  return { success: true };
});
```

### Template: Firestore Create (`firestore/<path>/created.ts`)

```typescript
import { onCreated } from '@snorreks/firestack';

export default onCreated(({ data }) => {
  console.log(`Document ${data.id} created:`, data);
});
```

### Template: Firestore Create with Zod (`firestore/<path>/created.ts`)

```typescript
import { onCreatedZod } from '@snorreks/firestack';
import { z } from 'zod';

const DocSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

export default onCreatedZod(
  DocSchema,
  ({ data }) => {
    console.log(`Valid document ${data.id} created`);
  }
);
```

### Template: Firestore Update (`firestore/<path>/updated.ts`)

```typescript
import { onUpdated } from '@snorreks/firestack';

export default onUpdated(({ data }) => {
  console.log('Before:', data.before);
  console.log('After:', data.after);
});
```

### Template: Firestore Delete (`firestore/<path>/deleted.ts`)

```typescript
import { onDeleted } from '@snorreks/firestack';

export default onDeleted(({ data }) => {
  console.log(`Document ${data.id} deleted`);
});
```

### Template: Auth Create (`auth/created.ts`)

```typescript
import { onAuthCreate } from '@snorreks/firestack';

export default onAuthCreate(
  async (user, context) => {
    console.log('User created:', user.uid, user.email);
    return { success: true };
  }
);
```

### Template: Auth Delete (`auth/deleted.ts`)

```typescript
import { onAuthDelete } from '@snorreks/firestack';

export default onAuthDelete(
  async (user, context) => {
    console.log('User deleted:', user.uid);
    return { success: true };
  }
);
```

### Template: Scheduler (`scheduler/<name>.ts`)

```typescript
import { onSchedule } from '@snorreks/firestack';

export default onSchedule(
  (context) => {
    console.log('Scheduled job running:', context);
  },
  {
    schedule: 'every day 00:00',
    timeoutSeconds: 540,
    memory: '256MiB',
  }
);
```

### Template: Storage Finalized (`storage/finalized.ts`)

```typescript
import { onObjectFinalized } from '@snorreks/firestack';

export default onObjectFinalized(({ data }) => {
  console.log(`Object finalized: ${data.name} (${data.contentType})`);
});
```

### Template: Storage Deleted (`storage/deleted.ts`)

```typescript
import { onObjectDeleted } from '@snorreks/firestack';

export default onObjectDeleted(({ data }) => {
  console.log(`Object deleted: ${data.name}`);
});
```

### Template: RTDB Created (`database/<ref>/created.ts`)

```typescript
import { onValueCreated } from '@snorreks/firestack';

export default onValueCreated(
  (event) => {
    console.log('New data:', event.data.val());
  },
  { ref: '{{ref}}' }
);
```

---

### Step 4: Write the File

Create the directory structure if needed, then write the file using the `Write` tool.

### Step 5: Optional Build Check

Ask the user if they want to verify the new function compiles:

```bash
firestack build --mode <mode>
```

### Step 6: Confirm

Tell the user what was created and the expected deployed function name.

```
Created: src/controllers/api/hello.ts
Deployed name: hello
Trigger: HTTP
```
