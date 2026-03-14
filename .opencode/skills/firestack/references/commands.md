# Firestack Commands

| Command | Description | Key Options |
| --- | --- | --- |
| `firestack deploy` | Builds and deploys functions to Firebase. | `--flavor`, `--dry-run`, `--force`, `--only`, `--all`, `--concurrency`, `--retryAmount`, `--verbose`. |
| `firestack emulate`| Starts the Firebase emulator with live reload. | `--open`, `--watch`, `--no-watch`, `--init`, `--no-init`, `--projectId`, `--only`, `--emulators`. |
| `firestack rules` | Deploys security rules and indexes. | `--only`, `--force`, `--flavor`. |
| `firestack delete` | Removes unused functions from Firebase. | `--all`, `--dry-run`, `--flavor`. |
| `firestack scripts`| Runs a custom script from the scripts directory. | `[scriptName]`, `--flavor`, `--engine`. |
| `firestack logs` | View Cloud Function logs. | `--lines`, `--since`, `--open`, `--flavor`. |

## Workflows

### Deployment
Firestack uses a two-phase deployment:
1. **Planning**: Identifies changes, builds, and checks checksums.
2. **Execution**: Deploys via `firebase-tools`.

Use `--verbose` to see the full Firebase CLI output.

### Emulation
- **Smart Defaults**: Auth is always enabled. Pub/Sub is auto-enabled if scheduler functions are detected.
- **Isolated Config**: `firebase.json` is generated in `dist/emulator`.
- **Initialization**: Init scripts run as soon as the Emulator UI is ready.
