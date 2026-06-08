# `/firestack dataconnect [mode]`

Deploy Firebase Data Connect schema and connectors.

## When to Use

- User says "deploy dataconnect", "deploy data connect", "deploy sql connect"
- User invokes `/firestack dataconnect` or `/firestack dataconnect --mode production`

## Workflow

### Step 1: Validate Configuration

Read `firestack.config.ts` or `firestack.json`. Check that:
- A mode is selected (from `modes` config or `--mode` flag)
- The `dataconnectDirectory` (default: `dataconnect`) exists and contains `dataconnect.yaml`

### Step 2: Detect Changes

Checksums are generated for all `.yaml` and `.gql` files in the dataconnect directory. If no files have changed since the last deployment, the command skips and reports:

```
✅ No changes detected in dataconnect. Skipping deployment.
```

### Step 3: Deploy

```bash
# Basic deploy
firestack dataconnect --mode <mode>

# Force deploy even if unchanged
firestack dataconnect --mode <mode> --force
```

The command creates a temporary `firebase.json` with the dataconnect service config and runs `firebase deploy --only dataconnect`.

### Step 4: Cache Update

After a successful deploy, checksums are saved locally (`dist/.checksums/<mode>/checksums.json`) and remotely (if a cloud cache callable is configured via `cloudCacheFileName`).

## Flags

| Flag | Description |
|---|---|
| `--mode <mode>` | Mode context (required) |
| `--force` | Force deploy even if no files changed |
| `--projectId <id>` | Override Firebase project ID |
| `--packageManager <pm>` | Package manager (npm, yarn, pnpm, bun, global) |
| `--cloudCacheFileName <name>` | Cloud cache file name |
| `--dataconnectDirectory <dir>` | Override dataconnect directory (default: `dataconnect`) |
| `--verbose` | Enable verbose logging |
| `--debug` | Enable debug mode |

## Integration with `firestack deploy`

When you run `firestack deploy`, Data Connect is deployed automatically alongside rules and functions. Use these flags to control behavior:

```bash
# Skip Data Connect deployment
firestack deploy --skip-dataconnect

# Deploy only Data Connect
firestack deploy --only dataconnect

# Deploy only Data Connect and rules
firestack deploy --only dataconnect,rules
```

## Caching

Deployments are cached by checksum. The cache key is `dataconnect`. Checksums are computed from the combined content of all `.yaml` and `.gql` files in the dataconnect directory, sorted by relative path for determinism.

- **Local cache:** `dist/.checksums/<mode>/checksums.json`
- **Remote cache:** Updated via the `cloudCacheFileName` callable (same as functions and rules)
