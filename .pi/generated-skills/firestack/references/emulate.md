# `/firestack emulate [mode]`

Start the Firebase Emulator Suite with live reload.

## When to Use

- User says "start emulator", "run locally", "emulate", "dev server"
- User invokes `/firestack emulate` or `/firestack emulate --mode development`

## Workflow

### Step 1: Validate Configuration

Read `firestack.config.ts` or `firestack.json`. Check that `modes` contains the requested mode. If no mode specified, ask the user or use the first mode.

### Step 2: Check for Init Script

Check if `scriptsDirectory/<initScript>` exists (default: `scripts/on_emulate.ts`).
- If missing and the user hasn't explicitly disabled init, warn them: "No `scripts/on_emulate.ts` found. The emulator will start without seed data. Run `/firestack setup emulate` to create one."

### Step 3: Start Emulator

```bash
# Basic start
firestack emulate --mode <mode>

# Common variants
firestack emulate --mode <mode> --open          # Auto-open Emulator UI
firestack emulate --mode <mode> --no-watch      # Disable live reload
firestack emulate --mode <mode> --no-init       # Skip on_emulate.ts
firestack emulate --mode <mode> --force         # Kill existing port processes
firestack emulate --mode <mode> --only functions,firestore  # Limited services
```

### Step 4: Monitor Output

Watch the output for:
- `✅ Emulator initialization complete.` — The `on_emulate.ts` script ran successfully.
- `Emulator UI available at http://localhost:4000` — The UI is ready.
- Function endpoints listed for HTTP functions.

### Step 5: Provide Local URLs

Once running, tell the user:

```
Emulator UI: http://localhost:4000
Firestore: localhost:8080
Auth: localhost:9099
Functions: localhost:5001
Storage: localhost:9199
```

(Note: Ports may vary if `emulatorPorts` is configured.)

## Stopping the Emulator

The emulator runs in the foreground. To stop it:
- Press `Ctrl+C` in the terminal.
- Or run `firestack emulate --mode <mode> --force` to kill and restart.

## Troubleshooting

| Issue | Resolution |
|---|---|
| `Port already in use` | Use `--force` to kill existing processes, or configure `emulatorPorts` |
| `initScript not found` | Create `scripts/on_emulate.ts` or disable with `--no-init` |
| `Java not found` | The Firebase emulator requires Java. Install OpenJDK 11+ |
| `Functions not loading` | Check that each function file has exactly one `export default` |
| `Live reload not working` | Ensure `--watch` is enabled and the file is inside `functionsDirectory` |

## Full Flag Reference

| Flag | Description |
|---|---|
| `--mode <mode>` | Mode context. |
| `--open` | Open Emulator UI in browser. |
| `--watch` / `--no-watch` | Live reload (default: `true`). |
| `--init` / `--no-init` | Run `initScript` (default: `true`). |
| `--force` / `--no-force` | Kill existing port processes (default: `false`). |
| `--projectId <id>` | Override Firebase project ID. |
| `--only <services>` | Limited services (e.g., `functions,firestore`). |
| `--tsconfig <path>` | Path to a custom `tsconfig.json` (e.g., `tsconfig.app.json`). |
| `--verbose` | Stream full emulator logs. |
