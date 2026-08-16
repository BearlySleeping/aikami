// apps/backend/firebase/src/discord/types.ts
// biome-ignore-all lint/style/useNamingConvention: mirrors Discord's wire-format JSON keys (custom_id, application_id, SCREAMING_SNAKE interaction/response type names) — a translation layer would add code for no benefit
//
// Minimal local shapes for the Discord Interactions payloads this endpoint
// handles (slash commands, modal submits). Not the full Discord API surface
// — see scripts/src/lib/discord/types.ts for the same "keep it local and
// narrow" reasoning applied to the guild-management CLI.

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

/** A submitted modal text input, nested one level under an action row. */
export type DiscordModalComponent = { type: 4; custom_id: string; value: string };
export type DiscordModalActionRow = { type: 1; components: DiscordModalComponent[] };

export type DiscordInteractionData = {
  /** Slash command name, e.g. "bug" — present on APPLICATION_COMMAND. */
  name?: string;
  /** Modal custom_id, e.g. "bug_report_modal" — present on MODAL_SUBMIT. */
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
  /** Present when the interaction fires inside a guild. */
  member?: { user?: DiscordUser };
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
