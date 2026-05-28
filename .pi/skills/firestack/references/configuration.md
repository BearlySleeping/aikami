# Firestack Configuration

Firestack supports two configuration formats: `firestack.config.ts` (recommended) and `firestack.json`.

## `firestack.config.ts` (Recommended)

Use this format when you need dynamic configuration or TypeScript path aliases from `tsconfig.json`.

```ts
// firestack.config.ts
import { defineConfig } from "@snorreks/firestack";
import { defaultRegion } from "@myproject/constants";

export default defineConfig(({ mode }) => {
  const isProduction = mode === "production";

  return {
    region: isProduction ? "us-east1" : defaultRegion,
    modes: {
      development: "my-project-dev",
      production: "my-project-prod",
    },
    functionsDirectory: "src/controllers",
    rulesDirectory: "src/rules",
    minify: isProduction,
    nodeVersion: "24",
  };
});
```

The `defineConfig` helper accepts either:

- A **static config object**, or
- A **callback** that receives `{ mode }` where `mode` is the value of the `--mode` CLI flag.

## `firestack.json`

If you prefer a static config file:

```json
{
  "$schema": "./node_modules/@snorreks/firestack/firestack.schema.json",
  "modes": {
    "development": "my-project-dev",
    "staging": "my-project-staging",
    "production": "my-project-prod"
  },
  "region": "us-central1",
  "functionsDirectory": "src/controllers",
  "rulesDirectory": "src/rules",
  "firestoreRules": "src/rules/firestore.rules",
  "storageRules": "src/rules/storage.rules",
  "scriptsDirectory": "scripts",
  "initScript": "on_emulate.ts",
  "nodeVersion": "22",
  "engine": "bun",
  "packageManager": "global",
  "minify": true,
  "sourcemap": true,
  "keepNames": false,
  "external": [],
  "emulators": ["auth", "firestore", "functions", "pubsub", "storage"],
  "emulatorPorts": {
    "auth": 9099,
    "firestore": 8080,
    "functions": 5001
  },
  "rulesTests": {
    "firestore": {
      "rulesFile": "src/rules/firestore.rules",
      "testPattern": "tests/rules/**/*.rules.test.ts",
      "projectId": "firestack-rules-test"
    },
    "storage": {
      "rulesFile": "src/rules/storage.rules",
      "testPattern": "tests/storage-rules/**/*.rules.test.ts",
      "projectId": "firestack-rules-test"
    }
  }
}
```

## Options Reference

| Option               | Type                                             | Default           | Description                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modes`              | `Record<string, string>`                         | `{}`              | Map of mode names to Firebase project IDs.                                                                                                                                                   |
| `region`             | `string`                                         | `us-central1`     | Default region for all deployed functions.                                                                                                                                                   |
| `functionsDirectory` | `string`                                         | `src/controllers` | Directory where function controllers are located.                                                                                                                                            |
| `rulesDirectory`     | `string`                                         | `src/rules`       | Directory containing Firestore/Storage rules and indexes.                                                                                                                                    |
| `firestoreRules`     | `string`                                         | —                 | Specific path to `firestore.rules` (overrides `rulesDirectory` lookup).                                                                                                                      |
| `storageRules`       | `string`                                         | —                 | Specific path to `storage.rules` (overrides `rulesDirectory` lookup).                                                                                                                        |
| `scriptsDirectory`   | `string`                                         | `scripts`         | Directory for custom maintenance/initialization scripts.                                                                                                                                     |
| `initScript`         | `string`                                         | `on_emulate.ts`   | Script run automatically when starting the emulator.                                                                                                                                         |
| `nodeVersion`        | `"18" \| "20" \| "22" \| "24"`                   | `"22"`            | Node.js runtime version for Cloud Functions.                                                                                                                                                 |
| `engine`             | `"bun" \| "node"`                                | `"bun"`           | Execution engine for running scripts (`bun` or `node`).                                                                                                                                      |
| `packageManager`     | `"npm" \| "yarn" \| "pnpm" \| "bun" \| "global"` | `"global"`        | Package manager for `firebase` commands. `"global"` uses the system `firebase` CLI.                                                                                                          |
| `minify`             | `boolean`                                        | `true`            | Whether esbuild minifies bundled function code.                                                                                                                                              |
| `sourcemap`          | `boolean`                                        | `true`            | Whether esbuild generates sourcemaps.                                                                                                                                                        |
| `keepNames`          | `boolean`                                        | `false`           | Whether to keep original function names in the bundle (useful for debugging).                                                                                                                |
| `external`           | `string[]`                                       | `[]`              | Dependencies to treat as external (installed in the function env at deploy time).                                                                                                            |
| `includeFilePath`    | `string`                                         | `src/logger.ts`   | Relative path to a file that is auto-imported at the top of every generated function index. Useful for initializing logging, OpenTelemetry, or Sentry. Only imported if the file exists.     |
| `emulators`          | `FirebaseEmulator[]`                             | `[]`              | Explicit list of emulators to enable. Available: `auth`, `functions`, `firestore`, `database`, `hosting`, `pubsub`, `storage`, `eventarc`, `extensions`, `ui`, `hub`, `logging`, `appcheck`. |
| `emulatorPorts`      | `Record<FirebaseEmulator, number>`               | —                 | Custom ports for individual emulators (e.g., `{ "auth": 9099 }`).                                                                                                                            |
| `rulesTests`         | `object`                                         | —                 | Configuration for `test:rules` (see below).                                                                                                                                                  |

## Rules Testing Configuration

Configure `firestack test:rules` via the `rulesTests` object:

```json
{
  "rulesTests": {
    "firestore": {
      "rulesFile": "src/rules/firestore.rules",
      "testPattern": "tests/rules/**/*.rules.test.ts",
      "projectId": "demo-rules-test"
    },
    "storage": {
      "rulesFile": "src/rules/storage.rules",
      "testPattern": "tests/storage-rules/**/*.rules.test.ts",
      "projectId": "demo-rules-test"
    }
  }
}
```

| Property      | Required | Description                                                               |
| ------------- | -------- | ------------------------------------------------------------------------- |
| `rulesFile`   | Yes      | Path to the `.rules` file (relative to project root or `rulesDirectory`). |
| `testPattern` | Yes      | Glob pattern for test files (e.g., `tests/rules/**/*.rules.test.ts`).     |
| `projectId`   | No       | Project ID for the emulator (default: `firestack-rules-test`).            |

## Project Structure Convention

Firestack expects a conventional layout. Only the function files themselves are auto-discovered; everything else is referenced via config:

```
project-root/
  firestack.config.ts     # or firestack.json
  src/
    controllers/          # functionsDirectory
      api/
      callable/
      firestore/
      auth/
      scheduler/
      storage/
      database/
    rules/                # rulesDirectory
      firestore.rules
      firestore.indexes.json
      storage.rules
    assets/
  scripts/                # scriptsDirectory
    on_emulate.ts
  tests/
    rules/
```
