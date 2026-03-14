# Cloud Functions Triggers (v2)

Firestack supports all standard Firebase v2 triggers via `@snorreks/firestack`.

## HTTP Triggers
```typescript
import { onRequest } from "@snorreks/firestack";

export default onRequest((req, res) => {
  res.send({ message: "Hello from Firestack!" });
}, {
  region: "us-central1",
  memory: "256MiB",
});
```

## Callable Triggers
```typescript
import { onCall } from "@snorreks/firestack";

export default onCall((request) => {
  return { data: request.data };
});
```

## Firestore Triggers
```typescript
import { onDocumentCreated } from "@snorreks/firestack";

export default onDocumentCreated("users/{uid}", (event) => {
  const data = event.data.data();
  console.log(`User created: ${event.params.uid}`);
});
```

## Scheduled Triggers
```typescript
import { onSchedule } from "@snorreks/firestack";

export default onSchedule("0 0 * * *", (event) => {
  console.log("Daily cleanup job started.");
});
```

## Other Triggers
- `onDocumentUpdated`, `onDocumentDeleted`, `onDocumentWritten`
- `onValueCreated`, `onValueUpdated`, `onValueDeleted`, `onValueWritten` (Realtime Database)
- `onObjectFinalized`, `onObjectDeleted`, `onObjectArchived`, `onObjectMetadataUpdated` (Storage)
- `onMessagePublished` (Pub/Sub)
- `onUserCreated`, `onUserDeleted` (Auth)
