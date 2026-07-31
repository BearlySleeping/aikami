# `/firestack scripts [name] [args...]`

Run a custom TypeScript script from the `scriptsDirectory` with Firestack configuration.

## When to Use

- User says "run script", "execute seed script", "run migration"
- User wants to run a maintenance script with Firestack's project context

## Workflow

1. Read `firestack.config.ts` (or `firestack.json`) for `scriptsDirectory`.
2. Check that the script file exists.
3. Run the script.
4. Report the output.

## Command

```bash
# Run a script by name (without extension)
firestack scripts myScript --mode <mode>

# Pass arguments to the script
firestack scripts myScript --mode <mode> -- arg1 arg2

# Run with verbose output
firestack scripts myScript --mode <mode> --verbose
```

### Options

| Option | Description |
|---|---|
| `--mode <mode>` | Mode context. |
| `--engine <engine>` | Execution engine: `bun` (default) or `node`. |
| `--verbose` | Show verbose output. |
| `--silent` | Suppress non-error output. |

### Environment Variables Passed to Scripts

| Variable | Description |
|---|---|
| `FIREBASE_PROJECT_ID` | Project ID for the current mode. |
| `FIREBASE_MODE` | The active mode name. |

## Example Scripts

```typescript
// scripts/cleanup_sessions.ts
import { getFirestore } from '../src/configs/database';

const db = getFirestore();
const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const snapshot = await db
  .collection('sessions')
  .where('lastActive', '<', cutoff)
  .get();

const batch = db.batch();
snapshot.docs.forEach((doc) => batch.delete(doc.ref));
await batch.commit();

console.log(`Cleaned up ${snapshot.size} old sessions.`);
```

Run it:

```bash
firestack scripts cleanup_sessions --mode development
```
