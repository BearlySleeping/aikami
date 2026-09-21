# Emberwatch polish brief (Astra handoff)

Machine-readable source: [`emberwatch_polish_brief.json`](./emberwatch_polish_brief.json).
Authoring workflow: [`docs/guides/emberwatch-authoring.md`](../guides/emberwatch-authoring.md).
Pipeline audit: [`docs/architecture/emberwatch-map-authoring.md`](../architecture/emberwatch-map-authoring.md).

> This is **direction, not layout**. The next phase gives GPT-6 Astra creative
> ownership of the final five-map polish. Improve composition freely; do not
> change locked identities and keep every required route navigable.

## Current topology

| Map | Cells | Role | Walkable |
|---|---|---|---|
| `village` | 64×48 | hub square + arrival | 77.7% |
| `inn` | 28×20 | interior, story | 65.5% |
| `merchant_shop` | 24×18 | interior, vendor + evidence | 63.2% |
| `old_road` | 72×36 | transitional journey, two routes | 78.1% |
| `ruined_shrine` | 40×36 | climax ruin | 76.8% |

Transitions form a reciprocal graph: village ⇄ inn / merchant_shop / old_road,
old_road ⇄ ruined_shrine.

## Visual direction and palette

Warm muted woodland-fantasy border village. The **ward tree is the emotional
centre** and must read as visually dominant without changing its gameplay
identity. Materials follow the pack prose (timber, soot, moss, damp stone,
ember light), soft upper-left key light, grounded contact shadows, crisp
silhouettes at native game scale. Palette direction: moss green / trodden earth
/ cold stone ground, dark oak + warm birch wood, ember-orange and ward-teal
accents, soot iron. Keep terrain and props on the same value range.

## Scale and grid

- 32px ground grid; authoring is in **cells**.
- Player/actor footprint 32×32 anchored bottom-centre; body extends 32px above
  the feet; LPC standing block 48×64.
- Companion-safe route width: **3 cells**.

## Landmark priorities

1. `ward_tree_landmark` (village) — primary focus, identity locked.
2. `shrine_arch` + `ward_socket` (ruined_shrine) — ritual focal point.
3. `village_gate`, `village_well`, `notice_board` (village) — wayfinding.
4. `waystation_cart`, `road_notice` (old_road) — journey beats.

## Required clear paths

- village: north gate → south gate (≥3 cells); west gate → east gate (≥3).
- village: every building door → nearest primary route (≥2).
- old_road: road junction → shrine gate (≥3).
- ruined_shrine: south gate → ritual apron (≥2).

## Story / NPC locations

NPCs and evidence objectives are listed in the JSON brief. Their **ids are
locked**; moving them is a polish edit, renaming them is a gameplay change.

## Legacy-art TODOs

Six frames still render from the legacy grid atlas: `crate.png`, `table.png`,
`bed.png`, `counter.png`, `bookshelf.png`, `anvil.png`. The actionable
manifest is
[`emberwatch_legacy_prop_replacements.json`](./emberwatch_legacy_prop_replacements.json).
The polish target is **zero accidental legacy grid-prop dependencies**.

## Audit locations

- `docs/reference/emberwatch-visual-report.json` — per-prop + per-map report.
- `docs/reference/emberwatch-map-validation.json` — navigation/identity rules.
- `docs/reference/emberwatch-coverage-audit.json` — coverage blockers.
- `.local/releases/evidence/emberwatch-visual-audit/contact_sheet.png` — human
  contact sheet.

## Commands

```shell
bun run emberwatch:studio            # validate → regenerate → serve → client
bun run emberwatch:studio --watch    # rebuild on edit
bun run emberwatch:validate          # navigation + identity rules
bun run emberwatch:visual-report     # machine-readable visual report
bun run emberwatch:visual-audit      # contact sheet
bun run emberwatch:locked-ids        # stable-identity guard
bun run emberwatch:legacy-props      # legacy replacement status
bun run emberwatch:props             # re-sync the manifest prop table
bun run emberwatch:audit             # coverage audit
```

## Definition of done

- All five maps: `emberwatch:validate` 0 blockers, `emberwatch:audit` 0 blockers.
- Regeneration is deterministic (twice, empty diff).
- Locked identities unchanged unless explicitly requested and re-sealed.
- Required clear paths remain navigable.
- Zero remaining legacy grid-prop dependencies.
