# `/firestack delete [mode]`

Delete unused Firebase Cloud Functions from a project.

## When to Use

- User says "delete functions", "remove functions", "clean up functions"
- User wants to remove functions that no longer exist in the codebase

## Workflow

### Step 1: Dry-Run First

Always start with a dry-run to see what would be deleted:

```bash
firestack delete --mode <mode> --dry-run
```

This lists all functions in the Firebase project that are NOT in the local codebase. These are "orphaned" functions that will be deleted.

### Step 2: Confirm

Show the user the list of functions that would be deleted and ask for confirmation.

### Step 3: Execute

```bash
# Delete orphaned functions (functions in Firebase but not in local codebase)
firestack delete --mode <mode>

# Delete ALL functions in the project (use with extreme caution)
firestack delete --mode <mode> --all
```

### Options

| Option | Description |
|---|---|
| `--mode <mode>` | Mode context (required). |
| `--dry-run` | Show what would be deleted without executing. |
| `--all` | Delete ALL functions in the project (not just orphaned ones). |
| `--projectId <id>` | Override Firebase project ID. |
| `--packageManager <pm>` | Package manager (`npm`, `yarn`, `pnpm`, `bun`, `global`). |
| `--verbose` | Show verbose output. |

## Example

```bash
# Check what would be deleted
firestack delete --mode development --dry-run

# Delete orphaned functions
firestack delete --mode development

# Delete everything (dangerous!)
firestack delete --mode development --all
```
