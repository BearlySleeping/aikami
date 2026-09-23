# Testing After .pi Changes

**Always test after modifying anything in `.pi/`.** No exceptions.

## Where `.pi` tests live

Tests sit next to the code they cover, under `.pi/extensions/lib/*.test.ts`
and `.pi/scripts/*.test.ts`. There is no `.pi/tests/` directory.

`.pi/extensions/*.ts` (top level) are loaded as extensions; a `.test.ts` file
placed directly there would be picked up as an extension. Keep extension tests
in `.pi/extensions/lib/`, where the loader does not treat them as extensions.

## Run them through Moon

```bash
bun moon run pi:automation-unit   # the deterministic suite CI runs
bun moon run pi:typecheck
bun moon run pi:lint
```

Moon supplies the prerequisites a bare runner misses. Do not run a bare
`bun test <file>` from a project directory — see `AGENTS.md`'s validation rule.

`pi:test` (bare `bun test extensions/` from `.pi`) exists for local
convenience but is `runInCI: false`; `pi:automation-unit` is the CI gate.

## `.pi/skills/` changes → verify:

- YAML frontmatter has `name` and `description`
- No unquoted colons in compact mappings (use `>-` for multi-line descriptions)
- Run `/skills reload` after changes

## Packages changed alongside `.pi`

Use the owning project's Moon task, e.g.:

```bash
bun moon run schemas:test
bun moon run schemas:typecheck
```

## After all tests pass → run:

```
/reload          # Reload extensions
/skills reload   # Reload skills
```

## If tests fail:

1. Check import paths — extension code uses relative imports, tests import the
   module under test by relative path
2. Run `bun moon run pi:typecheck` for type errors
3. Run `moon_detect_affected` — `:fix` may be needed before tests pass
