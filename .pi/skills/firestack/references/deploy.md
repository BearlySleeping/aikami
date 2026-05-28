# `/firestack deploy [mode]`

Build and deploy Firebase Cloud Functions, rules, and indexes to a specific mode.

## When to Use

- User says "deploy", "deploy to production", "ship it", "push functions"
- User invokes `/firestack deploy` or `/firestack deploy --mode production`

## Workflow

### Step 1: Validate Configuration

Read `firestack.config.ts` (or `firestack.json`). If missing, abort and suggest `/firestack setup config`.

Check that `modes` exists and contains the requested mode. If the user didn't specify a mode, ask them to pick one from the available modes.

### Step 2: Pre-Deploy Check

```bash
# Run a dry-run build to validate everything compiles
firestack deploy --mode <mode> --dry-run
```

If this fails, inspect the error output:
- **Type errors** → Fix the source code.
- **Missing dependencies** → Run `bun install` or `npm install`.
- **Invalid config** → Fix the config file.

### Step 3: Confirm Deployment (Destructive)

Show the user what will be deployed:

```
Deploying to: <project-id> (mode: <mode>)
Region: <region>
Functions directory: <functionsDirectory>
```

Ask for confirmation before proceeding.

### Step 4: Execute Deployment

```bash
# Standard deploy (functions + rules + indexes)
firestack deploy --mode <mode>

# With specific flags
firestack deploy --mode <mode> --force          # Ignore cache, redeploy all
firestack deploy --mode <mode> --only func1,func2  # Deploy specific functions only
firestack deploy --mode <mode> --skip-rules     # Deploy functions only
firestack deploy --mode <mode> --verbose        # Show full Firebase output
```

### Step 5: Post-Deploy Verification

After deployment succeeds:
1. List the deployed function URLs (for HTTP functions):
   ```bash
   firestack logs -n 20
   ```
2. For HTTP functions, the URL format is: `https://<region>-<project-id>.cloudfunctions.net/<function-name>`

## Common Issues

| Issue | Resolution |
|---|---|
| `firebase login required` | Run `firebase login` or `npx firebase login` |
| `functions already exist with different source` | Use `--force` to overwrite |
| `esbuild error` | Check for TypeScript errors in the function source |
| `external dependency not found` | Add it to `external` in function options or global `external` in config |
| `assets not found` | Ensure asset paths are relative to project root |

## Full Flag Reference

| Flag | Description |
|---|---|
| `--mode <mode>` | Target environment (required). |
| `--dry-run` | Validate build without deploying. |
| `--force` | Redeploy all functions, ignore cache. |
| `--only <names>` | Comma-separated list of specific functions. Automatically skips rules. |
| `--skip-rules` | Skip deploying rules and indexes. |
| `--concurrency <num>` | Parallel deployments (default: `5`). |
| `--retryAmount <num>` | Auto-retry failed deployments. |
| `--tsconfig <path>` | Path to a custom `tsconfig.json` (e.g., `tsconfig.app.json`). |
| `--verbose` | Show full Firebase CLI output. |
