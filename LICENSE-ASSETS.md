# Asset Licensing

**The code in this repository is [MIT](LICENSE). The bundled art and audio are
not.**

Aikami ships ~12,700 sprite, tileset, and audio assets. Most are derived from
the [Liberated Pixel Cup](https://lpc.opengameart.org/) (LPC) collection and
carry copyleft or attribution-required licenses. If you fork, redistribute, or
build a product on top of Aikami, **the MIT license on the code does not cover
these files.**

---

## Licenses in the bundle

Every bundled asset resolves to one or more of:

| License | Notes |
| --- | --- |
| `CC-BY-SA 3.0` / `CC-BY-SA 4.0` | Attribution + **share-alike** — derivatives must use the same license |
| `GPL 2.0` / `GPL 3.0` / `GPL 3.0+` | Copyleft |
| `OGA-BY 3.0` / `OGA-BY 3.0+` / `OGA-BY 4.0` | OpenGameArt attribution license |
| `OGA-SA 3.0` | OpenGameArt share-alike |
| `CC-BY` / `CC-BY 3.0` / `CC-BY 3.0+` / `CC-BY 4.0` | Attribution required |
| `CC0` | Public domain dedication — no obligations |
| `MIT` | Project-authored assets only |

Most LPC entries are multi-licensed (typically `OGA-BY 3.0` **and**
`CC-BY-SA 3.0` **and** `GPL 3.0`), which means you may pick whichever of the
listed licenses you can comply with.

---

## The manifests are the source of truth

Do not rely on this page for a specific file. Every asset's exact licenses,
authors, source URLs, and modification history are recorded per-asset in:

| File | Covers |
| --- | --- |
| `apps/frontend/client/static/game-data/asset_credits.json` | **All bundled assets** — the merged, authoritative manifest |
| `apps/frontend/client/static/game-data/lpc_credits.json` | LPC assets, generated from upstream `CREDITS.csv` |
| `apps/frontend/client/static/game-data/lpc_credits_supplement.json` | LPC library-level entries not covered by a per-asset CSV row |
| `scripts/src/lib/catalog/project_licenses.json` | Project-authored and non-LPC assets, hand-declared and reviewed |

Each entry looks like this:

```json
"lpc:dress:bodice_female:idle": {
  "licenses": ["OGA-BY 3.0", "CC-BY-SA 3.0", "GPL 3.0"],
  "authors": ["bluecarrot16", "Matthew Krohn (makrohn)", "Lanea Zimmerman (Sharm)"],
  "sourceUrls": ["https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles"],
  "licenseNote": "original princess.xcf by Sharm, extended to all poses by makrohn..."
}
```

To look one up:

```bash
bun -e 'const c = await Bun.file("apps/frontend/client/static/game-data/asset_credits.json").json(); console.log(c.credits["lpc:dress:bodice_female:idle"])'
```

---

## How attribution is enforced

This is not documentation-by-good-intentions. The catalog publish preflight
**hard-fails** if any asset tag resolves to none of the three credit sources
(`scripts/src/lib/catalog/`). There is deliberately no bypass flag: an asset
without provenance cannot ship.

Attribution is also user-visible in the app under **Credits**
(`apps/frontend/client/src/lib/views/game/credits/`), so end users of a build
see the authors without reading the repo.

---

## If you are redistributing

1. **Ship the credits.** Keep `asset_credits.json` and the in-app Credits
   screen intact, or reproduce the attribution some equivalent way.
2. **Respect share-alike.** If you modify a `CC-BY-SA` or `OGA-SA` asset, your
   modified asset must carry the same license. This does **not** infect the
   MIT-licensed code — but it does mean you cannot relicense the art.
3. **Check GPL entries.** Some LPC assets are GPL-licensed. Where an asset is
   multi-licensed, you may choose `CC-BY-SA` or `OGA-BY` instead.
4. **Don't assume.** Look the specific asset up in the manifest.

---

## If you are contributing art

Your contribution must:

- be compatible with the existing LPC-derived set (see
  [LPC style rules](https://lpc.opengameart.org/static/lpc-style-guide/styleguide.html)),
- come with a stated license, author name, and source URL, and
- be added to `scripts/src/lib/catalog/project_licenses.json` (non-LPC) or
  flow through the LPC credits pipeline.

A PR that adds an asset with no provenance will fail preflight and can't be
merged.

---

## Third-party model weights

AI model weights are **not** bundled — they're downloaded at runtime by the
local stack, each under its own license. See the
[Local Stack README](apps/backend/local-stack/README.md) for the per-model
licensing table.
