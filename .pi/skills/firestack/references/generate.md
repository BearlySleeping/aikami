# Generate Reference

## Overview

The `generate` command generates Data Connect SDKs from your local schema files. This is a **generation** operation (not a sync) — it reads your local `.gql` schema files and produces typed client and admin SDKs.

This is separate from the `sync` command (which pulls rules/indexes FROM Firebase) because it's a fundamentally different direction: generate produces code FROM local schema, sync pulls FROM the cloud.

## Workflow

When the user requests Data Connect SDK generation:

1. Verify the `dataconnectDirectory` exists (default: `dataconnect`).
2. Run the generate command.
3. Confirm the generated SDK files were created.

## Command

```bash
firestack generate [--watch] [--projectId <id>] [--mode <mode>]
```

### Options

| Option | Description |
|--------|-------------|
| `--mode <mode>` | The mode to use for config resolution. |
| `--projectId <id>` | The Firebase project ID. |
| `--watch` | Watch schema files for changes and regenerate SDKs continuously. |
| `--dataconnectDirectory <dir>` | Directory containing Data Connect config (default: `dataconnect`). |
| `--packageManager <pm>` | Package manager for firebase CLI (`npm`, `yarn`, `pnpm`, `bun`, `global`). |

### Behavior

- Runs `firebase dataconnect:sdk:generate` from the project root.
- With `--watch`: runs in continuous mode, regenerating SDKs on schema changes.
- Without `--watch`: runs once and exits.

### Example

```bash
# Generate SDKs once
firestack generate --mode development

# Watch and regenerate on changes
firestack generate --mode development --watch

# Override project ID and directory
firestack generate --projectId my-other-project --dataconnectDirectory my-schemas
```
