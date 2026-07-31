# `/firestack rules [mode]`

Deploy only Firestore rules, Storage rules, and Firestore indexes without deploying functions.

## When to Use

- User says "deploy rules", "update firestore rules", "push indexes"
- User wants to update rules without re-deploying functions

## Workflow

1. Read `firestack.config.ts` (or `firestack.json`) for configuration.
2. Run the rules deploy command.
3. Confirm deployment success.

## Command

```bash
# Deploy all rules and indexes
firestack rules --mode <mode>

# Force deploy even if unchanged
firestack rules --mode <mode> --force

# Deploy only specific components
firestack rules --mode <mode> --only firestore
firestack rules --mode <mode> --only storage
firestack rules --mode <mode> --only firestore,indexes
```

### Options

| Option | Description |
|---|---|
| `--mode <mode>` | Mode context (required). |
| `--only <components>` | Comma-separated list: `firestore`, `storage`, `indexes`. |
| `--force` | Force deploy even if no files changed. |
| `--projectId <id>` | Override Firebase project ID. |
| `--cloudCacheFileName <name>` | Cloud cache file name for checksums. |
| `--packageManager <pm>` | Package manager (`npm`, `yarn`, `pnpm`, `bun`, `global`). |
| `--verbose` | Show verbose output. |

## Notes

- Rules files are expected in the `rulesDirectory` (default: `src/rules`).
- Files expected: `firestore.rules`, `firestore.indexes.json`, `storage.rules`.
- Deployments are cached by checksum. Use `--force` to bypass the cache.
- This command is also available as part of `firestack deploy`, which deploys rules by default. Use `--skip-rules` with deploy to skip rules deployment.
