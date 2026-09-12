# apps/backend/audio

Local **ACE-Step** text-to-audio engine for the Aikami local stack (C-511).

`bun run dev` (alias of `dev:docker`) runs
`docker compose --profile audio up` against
`apps/backend/local-stack/compose.yaml` — the same topology the published
stack ships, so the dev engine cannot drift from the user engine.

- **Profile:** `audio` (opt-in — never in the shipped `COMPOSE_PROFILES`)
- **Port:** `8091` (`FIXED_PORTS.audio`)
- **Health:** `GET http://127.0.0.1:8091/health` → `{"status":"healthy"}`
- **Model:** `ACE-Step/ACE-Step-v1-3.5B` (Apache-2.0), pinned in
  `stack/models.manifest.json`

There is no Bun source here: the container is defined in the local-stack
topology and this app is only the launcher herdr points at.

## Generating audio

```bash
bun run --cwd apps/backend/image generate:asset music "calm forest loop"
bun run --cwd apps/backend/image generate:asset sfx "metal gate slam"
```

The ACE-Step server writes the WAV to its own filesystem and reports the
path; the CLI reads it back through `--audio-output-mount` (or
`MODELS_PATH`). See `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx`.
