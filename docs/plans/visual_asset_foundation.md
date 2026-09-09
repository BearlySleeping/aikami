# Visual asset foundation — execution order

Use the standard contract runner. No custom prompts, manual verification sessions or partial-contract handoffs are needed.

Run these **one at a time**, waiting for each contract to finish and its changes to merge before starting the next:

```bash
bun run contract C-504
bun run contract C-496
bun run contract C-505
bun run contract C-506
```

These are separate commands, not a script to launch all four together. If a contract already has an active run, resume that run rather than starting a duplicate. Start subsequent work from a base containing its predecessor's merged changes and the current specifications.

## Scope and dependencies

| Contract | Owns | Depends on |
|---|---|---|
| [C-504](../contracts/C-504-stable-character-appearance-identity.md) | Stable character identity, legacy migration and omitted-role equipment merge correctness | None |
| [C-496](../contracts/C-496-shared-visual-assets-and-playback.md) | Shared visual format/adapters, publication, playback, actor/prop/tileset asset previews and Hub tag identity | C-504 |
| [C-505](../contracts/C-505-canonical-scene-data-and-authoring-boundary.md) | Canonical scenes, stable placements, duplicate-ground cleanup and faithful whole-map preview | C-496 |
| [C-506](../contracts/C-506-emberwatch-visual-readability.md) | Atlas source alpha/lossless output, grounding, depth and readable movement boundaries | C-505 |

Each contract must satisfy all its mandatory acceptance criteria before handoff. C-496 no longer pauses for C-505: whole-map preview is owned entirely by C-505. The former prompt-only fixes are included in the contracts above.

## Normal pipeline behavior

See [the contract pipeline guide](../guides/contract-pipeline.md). An existing contract ID selects the existing-file path, skipping writer/critique and starting implementation (or a later stage according to its recorded status). Review the specification before invoking it; draft status alone does not prevent the runner from starting implementation.

The runner handles implementation, independent verification and the configured review/merge workflow. This documentation change does not launch a run, approve specifications, commit/push changes or authorize asset publication. No pipeline code or configuration was changed. Use the normal pipeline model configuration rather than a separate asset-specific setup; DeepSeek V4 Flash remains the cost-conscious default preference.

## Scope guardrails

- Aim for 40–65 changed files where practical; smaller contracts need not be padded.
- Reassess at 75 files and stop at 85 for a scope/split decision. Every PR stays below 100 files, including tests and generated metadata.
- C-496 is the broadest contract: inventory its complete scope before implementation. Combining its execution does not prove the implementation fits the budget. If it cannot fit, report that before exceeding the limit rather than silently omitting acceptance criteria.
- Keep real-game/offline checks, production-shaped fixtures and required visual evidence inside the normal verifier stage.
- Preserve original data and old asset revisions. Publishing to R2 requires separate authorization.

## Deferred work

The [semantic map authoring design](../architecture/semantic_map_authoring.md) describes future region/biome/prefab generation. Its JSON example is a proposal, not an implemented format. The decision remains **foundation now; biome compiler later**.
