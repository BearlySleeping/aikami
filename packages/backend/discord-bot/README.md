# @aikami/backend-discord-bot

Discord Gateway bot logic for the `#bugs-features-requests` forum channel.

## Use Case

This package owns two Discord surfaces, both started by `apps/backend/worker`:

**Gateway bot** (`startDiscordBot`) — seeing a brand-new forum thread or a
plain `@mention` requires a persistent connection (`THREAD_CREATE` /
`MESSAGE_CREATE` events), which stateless HTTP delivery can't give:

- **Auto-reply** on every new post in `#bugs-features-requests` — reminds the
  user to include diagnostics and not to ping developers directly.
- **Moderator-triggered GitHub issue creation** — a Moderator/Admin
  `@mention`s the bot with "github issue" in a thread, the bot summarizes the
  thread (LLM, OpenRouter) into a title/body and opens a GitHub issue,
  labeled from the thread's forum tag (`Bug` → `bug`, `Feature Request` →
  `enhancement`).
- **In-thread conversational replies** — anyone who replies to one of the
  bot's own messages gets a grounded LLM answer (same `.context/llms.txt`
  grounding as `/ask`), with recent thread history for continuity.
- **Plain `@AiKami` mentions anywhere else** the bot can read (not just the
  forum) get the same grounded reply, minus thread history — same per-user
  cooldown bucket as the in-thread reply above, so mixing the two doesn't
  double the rate limit.

**Interactions Endpoint** (`discordInteractions`) — Discord's stateless HTTP
webhook delivery for slash commands. Handles `/ask`. This used to be its own
Firebase Cloud Function
(`apps/backend/firebase/src/controllers/api/discord_interactions.ts`) before
moving here (`docs/contracts/C-418-p2`, OQ-3) so it could sit alongside the
Gateway bot on one always-on host instead of two separate deploy targets.
It's an Elysia plugin (`Elysia().post('/discord/interactions', ...)`),
mounted by whatever HTTP server the host runs.

Both surfaces share the same underlying "ask about Aikami" logic
(`@aikami/backend-project-ai`'s `askProjectAi`), grounded in
`.context/llms.txt`.

**Removed** (Discord revamp TASK 3c): `lib/role_sync.ts` and its test —
C-449 AC-5's channel → tool access mapping. `grantToolAccess`/
`revokeToolAccess` only ever logged (no real tool integration existed), and
its `ChannelUpdate` handler called `guild.members.fetch()` — every member —
on every single channel permission edit. Removed along with the
`GatewayIntentBits.GuildMembers` privileged intent that existed only to
serve it (nothing else in this package needs the member list).

This package has **no opinion on hosting or env sourcing** — it exports
`startDiscordBot(env)` / `discordInteractions(env)` plus the env shapes each
needs (`DISCORD_BOT_REQUIRED_ENV_KEYS`/`DiscordBotEnv`,
`DISCORD_INTERACTIONS_REQUIRED_ENV_KEYS`/`DiscordInteractionsEnv`), so any
process can start them. Today that's `apps/backend/worker`, an always-on
Compute Engine VM (Gateway connections can't run on pay-per-invocation Cloud
Functions, and colocating the Interactions Endpoint avoids a second deploy
target for one small webhook).

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `lint` | `biome lint .` | Lint code with Biome |
| `format` | `biome format .` | Format code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |
| `test` | `bun test` | Run tests |

## Dependencies

- `@aikami/backend-project-ai` — shared `askProjectAi`/`chatCompletion`
- `@aikami/constants` — shared Discord guild/channel/role/forum-tag ids
- `@aikami/logger` — logging
- `discord.js` — the only Gateway-connected client in this repo; everything
  else under `scripts/src/lib/discord/` deliberately uses `@discordjs/rest`
  only, since it never needed a persistent connection before this package.
- `elysia` — the Interactions Endpoint's HTTP plugin
- `tweetnacl` — Ed25519 signature verification for Interactions requests

## Usage

```typescript
import {
  DISCORD_BOT_REQUIRED_ENV_KEYS,
  startDiscordBot,
  DISCORD_INTERACTIONS_REQUIRED_ENV_KEYS,
  discordInteractions,
} from '@aikami/backend-discord-bot';

const botEnv = await loadEnvSomehow(DISCORD_BOT_REQUIRED_ENV_KEYS); // host's job
await startDiscordBot(botEnv);

const interactionsEnv = await loadEnvSomehow(DISCORD_INTERACTIONS_REQUIRED_ENV_KEYS);
new Elysia().use(discordInteractions(interactionsEnv)).listen(8080);
```

## Structure

```
src/
├── index.ts               # startDiscordBot() — Client setup, event wiring
└── lib/
    ├── types.ts            # DiscordBotEnv shape + required env keys
    ├── constants.ts        # Guild/role/channel/tag IDs, trigger phrase
    ├── ai_chat.ts           # GitHub-issue summarization (askProjectAi re-exported from @aikami/backend-project-ai)
    ├── github_issue.ts      # GitHub issue creation (plain fetch, GITHUB_ISSUES_TOKEN)
    ├── rate_limit.ts         # In-memory per-user/per-thread cooldowns
    ├── handlers/
    │   ├── thread_create.ts  # New-post auto-reply
    │   └── message_create.ts # Issue-trigger + conversational-reply dispatch
    └── interactions/          # Discord Interactions Endpoint (HTTP webhook, not Gateway)
        ├── types.ts            # Wire types + DiscordInteractionsEnv shape
        ├── verify.ts           # Ed25519 signature verification
        ├── respond.ts          # Deferred-response webhook edit
        └── handler.ts          # discordInteractions() Elysia plugin — handles /ask
```

Non-sensitive IDs (guild, forum channel, Moderator/Admin roles, forum tags)
now live in `@aikami/constants` (`packages/shared/constants/src/lib/discord.ts`)
— `lib/constants.ts` just re-exports the subset this package uses under its
existing local names, plus the bot-specific bits (issue-trigger phrase).
`@aikami/constants`'s `discord.ts` is itself kept in sync
BY HAND with `scripts/src/lib/discord/structure.ts` (the declarative source
of truth for the server layout) — update it there when the server structure
changes.
