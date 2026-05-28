# Testing After .pi Changes

**Always test after modifying anything in `.pi/`.** No exceptions.

## ⚠️ CRITICAL: `.test.ts` files must NOT live inside `.pi/extensions/`

Pi auto-discovers `.ts` files in `.pi/extensions/` as extensions. A `.test.ts`
file will cause extension loading to fail. Always place `.pi` tests in `.pi/tests/`.

## .pi/extensions/ changes → run:
```bash
bun test ./.pi/tests/imports.test.ts
```
This verifies all relative imports (MODE_PROJECT_MAP, APP_CONFIG, etc.) resolve correctly.

## .pi/skills/ changes → verify:
- YAML frontmatter has `name` and `description`
- No unquoted colons in compact mappings (use `>-` for multi-line descriptions)
- Run `/skills reload` after changes

## packages/shared/schemas/ changes → run:
```bash
bun test packages/shared/schemas/src/lib/api/telegram.test.ts
```
Or the full schemas suite:
```bash
cd packages/shared/schemas && bun test
```

## After all .pi tests pass → run:
```
/reload          # Reload extensions
/skills reload   # Reload skills
```

## If tests fail:
1. Check import paths — from `.pi/tests/foo.ts`, project root is `../../`
2. Run `bun run schemas:typecheck` for schema issues
3. Check `moon_detect_affected` — `:fix` may be needed before tests pass
