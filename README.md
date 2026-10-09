<div align="center">

# Aikami

### Imagine a campaign. Step into a world with a life of its own.

**Aikami is an open-source platform for AI-powered 2D RPG adventures in early development.**

We’re building toward a connected experience: imagine a campaign, explore its places,
meet its people, and make choices that can change their lives.

[![License: MIT](https://img.shields.io/github/license/BearlySleeping/aikami)](LICENSE)
[![Status](https://img.shields.io/badge/status-early%20development-orange)](#project-status)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/XuuhWvSxHH)

**[Try the early build](https://aikami.bearlysleeping.com)** ·
**[Staging build](https://aikami.stg.bearlysleeping.com)** ·
**[Follow development](https://github.com/BearlySleeping/aikami)** ·
**[Discord](https://discord.gg/XuuhWvSxHH)** ·
**[Contributing](CONTRIBUTING.md)**

</div>

---

## What an Aikami adventure aims to feel like

![Dialogue concept: Lyra speaks with Elder Thalia in a pixel-art tavern, with a persuasion check beside the conversation.](assets/concept/dialogue.webp)

*Dialogue concept · visual direction, not a screenshot of the current build. The full
concept set is catalogued in [asset notes](assets/concept/README.md); see the
[product vision](docs/intro/vision.md#visual-direction) for the visual direction.*

Start with a place and a problem:

> Create a frontier village around an old inn. Its protective ward is fading.
> Give me a suspicious merchant, a tired guard, and a quest I can resolve
> through persuasion or combat.

This is an **illustrative example**, not generated campaign output. The vision is to
review and reshape the proposed places, people, and quest, then explore them in a spatial
2D world. Reusable structures such as inns, shops, camps, and roads could form new
environments; optional generated art could add to the project’s existing visual material.

Today, Aikami can generate and save private narrative drafts. Those drafts are not yet
compiled into playable campaigns. Persistent residents with physical routines and
town-wide consequences are also planned work.

## Project status

| Status | What it means |
| --- | --- |
| **Current build** | An authored Emberwatch adventure, a spatial 2D foundation, local saves, and private narrative drafts. |
| **In development** | Reliable first-run and quest journeys, campaign time and resident identity foundations. |
| **Planned** | Physical resident routines, grounded and recoverable town consequences, and reviewed drafts compiled into playable campaigns. |

The game’s AI helps interpret actions and narrate results. Validated actions and deterministic
game rules control what can happen. Aikami is early software; the full campaign-creation and
living-world journey is not available yet. See the [development roadmap](https://github.com/BearlySleeping/aikami/issues).

## Try the early build

Open the [web client](https://aikami.bearlysleeping.com) or download the
[desktop app](https://github.com/BearlySleeping/aikami/releases/latest). A text AI provider
is required. You can configure a local model or your own cloud provider; cloud use requires
connectivity and may cost money. Image and voice generation are optional.

No account is required for local play and saves. Saves are device-local. Fully offline play
requires a configured local text model and cached content; first-time content or model
downloads can require network access. Cloud-provider dialogue is sent to the provider you
configure.

## Try the staging build

[**aikami.stg.bearlysleeping.com**](https://aikami.stg.bearlysleeping.com) is the preview
deploy. It follows the `staging` branch and redeploys on every push, so it shows work in
progress that has not reached the public build yet.

The interesting part is the [**Dev Console**](https://aikami.stg.bearlysleeping.com/dev) —
a set of isolated sandboxes for driving individual systems on their own, without playing
through a whole adventure to reach them. The **Combat Debug Workspace** exercises the
tactical resolver directly, **Creator Studio** and **World Gen** drive character and world
authoring, the **LPC** tools cover sprite import and animation, and the **Sandbox** group
holds the smaller map, camera, party-follow, and dialogue scenes.

A few things to know before you open it:

| | |
| --- | --- |
| **It is not stable.** | Expect rough edges and breaking changes — it is a preview, not a release. |
| **It is staging only.** | The console is compiled into staging builds and stripped from production, so `/dev` on the public build is a 404. |
| **Your data is separate.** | Staging runs against its own D1 database and its own R2 buckets, so it cannot read or write production accounts or the published asset catalog. |
| **Your saves stay yours.** | Campaigns, saves, and chat history are device-local either way. |

Bring your own text AI key, exactly as with the public build.

## Develop Aikami

The repository uses Bun and Moon. Emulator environment setup writes local `.env.emulator`
files with development-safe values and does not need the encrypted production secrets key.

```bash
git clone https://github.com/BearlySleeping/aikami
cd aikami
bun install
bun run setup:env
bun run dev
```

The client dev server is available at <http://localhost:5173>. `bun run setup:env` invokes
the root `decrypt-secrets` command in emulator mode; `bun run dev` runs the Moon client dev
task. Docker is optional and only needed to run the local AI stack. See the
[local stack guide](apps/backend/local-stack/README.md) for that setup.

For project commands and validation, use the project’s Moon tasks, such as
`bun moon run client:typecheck` or `bun moon run site:build`. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Project map

The monorepo contains the SvelteKit client and PixiJS game, an Astro landing site and docs,
a community hub, Cloudflare services, local AI services, and shared packages. The client
stores campaigns and saves on the player’s device; optional server features are separate.

For a deeper view, see the [architecture](docs/architecture/architecture.md),
[project structure](docs/guides/STRUCTURE.md), [setup guide](docs/intro/setup.md),
[developer workflow](docs/guides/dev-workflow.md), and [technical stack](docs/guides/STACK.md).
The [Local Stack README](apps/backend/local-stack/README.md) covers local text, image, and
voice services.

## Roadmap and participation

The next milestones focus on making the authored adventure reliable, giving residents
persistent routines and physical places, connecting player actions to recoverable town
changes, compiling reviewed ideas into playable campaigns, and improving community-pack
sharing. Follow current work in [GitHub Issues](https://github.com/BearlySleeping/aikami/issues).

Ideas, bug reports, and contributions are welcome. Start with
[CONTRIBUTING.md](CONTRIBUTING.md), browse
[good first issues](https://github.com/BearlySleeping/aikami/issues?q=is%3Aissue+state%3Aopen+label%3A%22good+first+issue%22),
or join [Discord](https://discord.gg/XuuhWvSxHH).

## License

The source code is [MIT licensed](LICENSE). Bundled art and audio have separate licenses;
check [LICENSE-ASSETS.md](LICENSE-ASSETS.md) and the attribution records before redistribution.
