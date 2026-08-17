// packages/backend/discord-bot/src/lib/interactions/types.ts
// biome-ignore-all lint/style/useNamingConvention: mirrors Discord's wire-format JSON keys (custom_id, application_id, SCREAMING_SNAKE interaction/response type names) — a translation layer would add code for no benefit
//
// Minimal local shapes for the Discord Interactions payloads the endpoint
// in ./handler.ts handles (slash commands, modal submits). Not the full
// Discord API surface — see scripts/src/lib/discord/types.ts for the same
// "keep it local and narrow" reasoning applied to the guild-management CLI,
// and ../types.ts for the unrelated DiscordBotEnv (Gateway bot) shape this
// file deliberately doesn't share a name with.

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  MODAL: 9,
} as const;

export type DiscordUser = { id: string; username: string };

/** Partial guild member object as it appears on a guild interaction. */
export type DiscordMember = {
  user?: DiscordUser;
  /** Role snowflakes the member holds in the guild. */
  roles?: string[];
};

/** A submitted modal text input, nested one level under an action row. */
export type DiscordModalComponent = { type: 4; custom_id: string; value: string };
export type DiscordModalActionRow = { type: 1; components: DiscordModalComponent[] };

export type DiscordInteractionData = {
  /** Slash command name, e.g. "ask" — present on APPLICATION_COMMAND. */
  name?: string;
  /** Modal custom_id — present on MODAL_SUBMIT. */
  custom_id?: string;
  /** Slash command string/number/bool options — present on APPLICATION_COMMAND. */
  options?: { name: string; value: string }[];
  /** Submitted modal field values — present on MODAL_SUBMIT. */
  components?: DiscordModalActionRow[];
};

export type DiscordInteraction = {
  id: string;
  application_id: string;
  type: (typeof InteractionType)[keyof typeof InteractionType];
  token: string;
  data?: DiscordInteractionData;
  /** Guild snowflake — absent when the interaction fired in a DM. */
  guild_id?: string;
  /** Present when the interaction fires inside a guild. */
  member?: DiscordMember;
  /** Present when the interaction fires in a DM. */
  user?: DiscordUser;
};

/** Pulls the first matching modal field's value out of a MODAL_SUBMIT payload. */
export function getModalValue(
  interaction: DiscordInteraction,
  customId: string,
): string | undefined {
  for (const row of interaction.data?.components ?? []) {
    for (const component of row.components) {
      if (component.custom_id === customId) {
        return component.value;
      }
    }
  }
  return undefined;
}

/** Pulls a slash command's string option value out of an APPLICATION_COMMAND payload. */
export function getOptionValue(interaction: DiscordInteraction, name: string): string | undefined {
  return interaction.data?.options?.find((opt) => opt.name === name)?.value;
}

export function interactionUsername(interaction: DiscordInteraction): string {
  return interaction.member?.user?.username ?? interaction.user?.username ?? 'unknown';
}

/** Snowflake of the invoking user — present on both guild (member.user) and DM (user) interactions. */
export function interactionUserId(interaction: DiscordInteraction): string | undefined {
  return interaction.member?.user?.id ?? interaction.user?.id;
}

/** Discord's `MESSAGE_FLAGS.EPHEMERAL` — only the invoking user sees the response. */
export const EPHEMERAL_FLAG = 1 << 6;

/** What the interactions handler needs from its environment — declared here, sourced by whatever process hosts it (apps/backend/worker, today). */
export const DISCORD_INTERACTIONS_REQUIRED_ENV_KEYS = [
  'DISCORD_PUBLIC_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
] as const;

export type DiscordInteractionsEnv = Record<
  (typeof DISCORD_INTERACTIONS_REQUIRED_ENV_KEYS)[number],
  string
>;
