# `/firestack build [mode]`

Build functions locally without deploying. Useful for validating that all functions compile correctly.

## When to Use

- User says "build functions", "compile functions", "check types"
- User wants to validate before deploying

## Workflow

1. Read `firestack.config.ts` (or `firestack.json`) for the `functionsDirectory`.
2. Run the build command.
3. Report any errors.

## Command

```bash
firestack build --mode <mode>
```

### Options

| Option | Description |
|---|---|
| `--mode <mode>` | Mode context for config resolution. |
| `--external <external>` | Comma-separated list of external dependencies. |
| `--node-version <version>` | Node.js version target (`18`, `20`, `22`, `24`). |
| `--minify` / `--no-minify` | Minify output (default from config). |
| `--sourcemap` / `--no-sourcemap` | Generate sourcemaps (default from config). |
| `--tsconfig <path>` | Path to a custom `tsconfig.json`. |

## Example

```bash
# Build with default settings
firestack build --mode development

# Build with specific tsconfig
firestack build --mode development --tsconfig tsconfig.app.json
```
