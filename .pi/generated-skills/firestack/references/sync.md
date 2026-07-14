# Sync Reference

## Overview

The `sync` command pulls Firestore rules, Storage rules, and Firestore indexes from Firebase into your local project. This is useful when changes have been made directly in the Firebase Console and you want to bring them into version control.

## Workflow

When the user requests a sync operation:

1. Read `firestack.config.ts` (or `firestack.json`) for project configuration.
2. Run the sync command with the appropriate mode.
3. Verify the synced files exist in the `rulesDirectory`.

## Command

```bash
firestack sync --mode <mode>
```

### Options

| Option | Description |
|--------|-------------|
| `--mode <mode>` | The environment/mode to sync from (maps to project ID in config). |
| `--projectId <id>` | Override the Firebase project ID. |
| `--only <targets>` | Only sync specific components (comma-separated: `firestore,storage,indexes`). |
| `--verbose` | Show detailed output. |
| `--packageManager <pm>` | Package manager for firebase CLI (`npm`, `yarn`, `pnpm`, `bun`, `global`). |

### Default Targets

If `--only` is not specified, all three targets are synced:
- `firestore` → `firestore.rules`
- `storage` → `storage.rules`
- `indexes` → `firestore.indexes.json`

### Output

All synced files are written to the `rulesDirectory` (default: `src/rules`). The directory is created automatically if it doesn't exist.

### Example

```bash
# Sync all rules and indexes
firestack sync --mode development

# Sync only Firestore rules
firestack sync --mode production --only firestore

# Sync rules and indexes
firestack sync --mode staging --only firestore,indexes
```
