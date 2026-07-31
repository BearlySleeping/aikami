# `/firestack logs [mode]`

View logs from Firebase Cloud Functions, Firestore, Auth, or Storage.

## When to Use

- User says "show logs", "check logs", "what's happening", "debug"
- User invokes `/firestack logs` or `/firestack logs --mode development`

## Workflow

1. Read `firestack.config.ts` (or `firestack.json`) for the project ID.
2. Run the logs command.
3. Parse and display the output.

## Command

```bash
# Basic usage
firestack logs --mode <mode>

# Show last 50 lines
firestack logs --mode <mode> --lines 50

# Show logs from the last hour
firestack logs --mode <mode> --since 1h

# Tail logs in real-time
firestack logs --mode <mode> --tail

# Open in Google Cloud Console
firestack logs --mode <mode> --open

# Filter by function
firestack logs --mode <mode> --only myFunction

# Show specific log type
firestack logs --mode <mode> --type firestore
```

### Options

| Option | Description |
|---|---|
| `--mode <mode>` | Mode context (required for project ID resolution). |
| `--projectId <id>` | Override Firebase project ID. |
| `--only <functions>` | Filter by function name(s). |
| `--lines <n>` / `-n <n>` | Number of log lines to fetch (default: 20). |
| `--limit <n>` | Alias for `--lines`. |
| `--since <time>` | Only show logs after this time (e.g., `1h`, `30m`, `1d`). |
| `--open` | Open logs in Google Cloud Console web browser. |
| `--tail` | Tail logs in real-time (continuous streaming). |
| `--type <type>` | Log type: `functions`, `firestore`, `auth`, `storage`, `all`. |
| `--packageManager <pm>` | Package manager (`npm`, `yarn`, `pnpm`, `bun`, `global`). |
| `--verbose` | Show verbose log output. |

## Example

```bash
# Check recent function logs
firestack logs --mode development --lines 30

# Debug a specific function in production
firestack logs --mode production --only api_hello --tail

# Check firestore activity in the last 2 hours
firestack logs --mode development --type firestore --since 2h
```
