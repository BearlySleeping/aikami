# Scripts

Knowledge maintenance scripts — generate `llms.txt`, update `CONTEXT.md`, etc.

## Running Scripts

Use the interactive script runner:
```bash
bun run scripts
```

Or run directly:
```bash
bun run scripts -- generate_llms
bun run scripts -- generate_context
```

## Structure

```
scripts/src/lib/
  cli_utils.ts          # Shared CLI helpers
  deploy/               # Deploy scripts
  ops/                  # Operational scripts
    dev_all.ts          # Start all dev services
    generate_llms_txt.ts
    generate_context.ts
    cleanup_vendor_dirs.ts
    validate_all.ts     # CI validation
  setup/                # Developer setup
    setup.ts            # Interactive onboarding
  test_blackbox/        # End-to-end test suite
```
