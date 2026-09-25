# Pi Runners

Standalone scripts that an agent or the contract pipeline invokes directly
(not pi tools). They are plain Bun entrypoints, loaded at runtime, and follow
the standard Aikami conventions (`$logger`, type-only imports, arrow
functions).

## Runner Layout

| File | Purpose |
|------|---------|
| `convention_gate.ts` | AST-aware convention review: deterministic Biome/tree-sitter checks plus a scored convention report |
| `mcp_bridge.ts` | Bridges an MCP server's tools into the pi tool surface over stdio |
| `test_healer.ts` | Self-healing visual test harness: runs visual suites, captures mismatches, proposes fixes |

## Notes

- This directory is tracked by Git; runners are executed by Bun, not bundled.
- Runners use `$logger` for consistent logging.
