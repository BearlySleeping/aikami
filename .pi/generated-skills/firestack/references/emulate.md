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

## Running Multiple Emulator Instances

Two emulator suites (e.g. a contract test run + a manual dev run) can run
concurrently. Each suite needs its own set of ports. Three ways to offset a
suite, in precedence order:

1. **Per-process environment variables** (recommended for process managers
   like herdr/overmind — each process gets its own env):

   ```
   FIRESTACK_EMULATOR_UI_PORT=4001
   FIRESTACK_EMULATOR_HUB_PORT=4401
   FIRESTACK_EMULATOR_AUTH_PORT=9199
   FIRESTACK_EMULATOR_FIRESTORE_PORT=8180
   FIRESTACK_EMULATOR_FUNCTIONS_PORT=5101
   FIRESTACK_EMULATOR_PUBSUB_PORT=8185
   FIRESTACK_EMULATOR_STORAGE_PORT=9299
   FIRESTACK_EMULATOR_DATABASE_PORT=9100
   FIRESTACK_EMULATOR_HOSTING_PORT=5100
   FIRESTACK_EMULATOR_DATACONNECT_PORT=9499
   ```

   The resolved ports are written into the generated `firebase.json`, so the
   spawned Firebase CLI binds exactly those ports.

2. **Mode-dependent config** — `defineConfig(({ mode }) => ...)` is
   re-evaluated with the resolved mode, so ports can branch per mode:

   ```ts
   export default defineConfig(({ mode }) => ({
     modes: { manual: 'demo-manual', contract: 'demo-contract' },
     emulatorPorts:
       mode === 'contract'
         ? { ui: 4001, hub: 4401, auth: 9199, firestore: 8180 }
         : { ui: 4000, hub: 4400, auth: 9099, firestore: 8080 },
   }));
   ```

   Run with `firestack emulate --mode contract` / `--mode manual`.

3. **Static `emulatorPorts` in the config** — same ports for every run;
   use different project directories for the second suite.

`--force` only kills processes on the ports this suite actually binds (the
enabled emulators + UI + hub). It never touches default ports of emulators
this suite does not run, so starting a second suite with `--force` cannot
bring down another suite's emulators.

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
| `--emulators <list>` | Comma-separated list of emulators to enable. |
| `--dataconnectDirectory <dir>` | Override dataconnect directory. |
| `--includeFilePath <path>` | File auto-imported into every function index. |
| `--minify` / `--no-minify` | Minify function output (default from config). |
| `--sourcemap` / `--no-sourcemap` | Generate sourcemaps (default from config). |
| `--polling` / `--no-polling` | Chokidar polling for file watch. Auto-detects inotify limits on Linux. |
| `--debug` | Enable debug mode (keeps temporary build files). |
| `--verbose` | Stream full emulator logs. |
| `--dry-run` | Build functions and rules but don't start emulator. |
| `--silent` | Suppress non-error output. |
