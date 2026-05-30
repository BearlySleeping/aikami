// apps/frontend/gamejs/src/core/api/dialogue_prompt_builder.ts
/**
 * Pure functions for building AI dialogue prompts.
 * Worker-ready: no Godot imports.
 */
import type { NpcTemplate, NpcDynamicData } from '../models/npc';
import type { PlayerSnapshot } from '../models/player';

const BASE_RULES = [
    'You are a NPC in a fantasy RPG engaging me in conversation.',
    'You should initiate the conversation with the player.',
    "Don't mention that you are an AI or that this is a game.",
    'Your responses should consist solely of your character\'s dialogue or implied actions, without prefixing them with your name or any identifiers.',
    'Do NOT add \'{npc_name}: \' at the beginning.',
    'Avoid breaking character or mentioning modern or out-of-context elements.',
];

const DEFAULT_ACTIONS = [
    'continue_conversation',
    'end_conversation',
    'attack_player',
];

export type DialoguePromptContext = {
    npc: NpcTemplate;
    player: PlayerSnapshot;
    dynamic: NpcDynamicData;
    currentTime: { day: number; hour: number; minute: number };
    calendarString: string;
    timeDifference?: string;
    messages: string[];
};

export type DialogueFunctionRequest = {
    name: string;
    description: string;
    messages: string[];
    fields: Array<{
        name: string;
        type: string;
        description: string;
        required?: boolean;
        enumValues?: string[];
    }>;
    useStream: boolean;
};

export type ParsedDialogueResponse = {
    textResponse: string;
    action: string;
    mood: string;
};

/**
 * Build the first-message prompt for an NPC conversation.
 */
export function buildFirstMessagePrompt(context: DialoguePromptContext): string {
    const lines: string[] = [];
    lines.push('--- Context ---');
    lines.push(...BASE_RULES);
    lines.push(..._buildMetadata(context));
    return lines.join('\n');
}

/**
 * Build a follow-up prompt from a player message.
 */
export function buildFollowUpPrompt(_context: DialoguePromptContext, playerMessage: string): string {
    return playerMessage;
}

/**
 * Build a summary prompt for extracting recollections.
 */
export function buildSummaryPrompt(context: DialoguePromptContext): string {
    const actualConversation = context.messages.slice(1);
    const messageList: string[] = [];
    for (let i = 0; i < actualConversation.length; i++) {
        const role = i % 2 === 0 ? 'player' : 'npc';
        messageList.push(`${role}: ${actualConversation[i]}`);
    }
    const currentConversationStr = messageList.join('\n');
    const lines: string[] = [];
    const taskIntro =
        'You are an NPC in a fantasy RPG. Reflect on the actual conversation below and summarize it into key points, focusing only on new insights and details explicitly mentioned. Summaries should directly relate to this interaction or reiterate relevant details from previous notes if they are referenced again. Avoid assumptions or attributing traits not directly mentioned in the conversation or previous notes. Each key point should be separated by a comma.';
    lines.push('--- Task ---');
    lines.push(taskIntro);
    lines.push(..._buildMetadata(context));
    lines.push('--- Actual Conversation ---');
    lines.push(currentConversationStr);
    if (context.dynamic.recollections.length === 0) {
        lines.push('--- Guidance for Summary Generation (Do Not Repeat) ---');
        lines.push(
            "Examples: 'Learned player is called Bob. Encountered player at the crossroads, player expressed a desire to learn magic, Discovered player's fear of dark forests, I revealed the secret path to the enchanted grove, We shared tales of ancient dragons.' These are examples. Generate new points based on the actual conversation.Note, you are not the player you are the character the player is interacting with.",
        );
    } else {
        lines.push('--- Previous Notes ---');
        lines.push(context.dynamic.recollections.join(','));
    }
    return lines.join('\n');
}

/**
 * Build a function-call request for structured NPC dialogue.
 */
export function buildDialogueFunctionRequest(context: DialoguePromptContext): DialogueFunctionRequest {
    const moodValues = Object.keys(context.npc.portraits);
    return {
        name: 'npc_dialogue',
        description: 'Process NPC dialogue inputs and generate dialogue outputs',
        messages: context.messages,
        fields: [
            {
                name: 'text_response',
                type: 'string',
                description: "The NPC's verbal response",
                required: true,
            },
            {
                name: 'action',
                type: 'array',
                description: 'A list of actions the NPC can take',
                required: false,
                enumValues: DEFAULT_ACTIONS,
            },
            {
                name: 'mood',
                type: 'string',
                description: "The NPC's current mood",
                required: false,
                enumValues: moodValues.length > 0 ? moodValues : ['neutral'],
            },
        ],
        useStream: true,
    };
}

/**
 * Parse a structured dialogue response from AI function output.
 */
export function parseDialogueResponse(data: Record<string, unknown>): ParsedDialogueResponse {
    return {
        textResponse: (data.text_response as string) ?? '',
        action: (data.action as string) ?? 'continue_conversation',
        mood: (data.mood as string) ?? 'neutral',
    };
}

/**
 * Trim conversation history to a maximum number of exchanges.
 * Always preserves the first (context) message.
 */
export function trimConversationHistory(messages: string[], maxExchanges: number = 10): string[] {
    if (messages.length <= 1 + maxExchanges * 2) {
        return messages;
    }
    const context = messages[0];
    const recent = messages.slice(-maxExchanges * 2);
    return [context, ...recent];
}

function _buildMetadata(context: DialoguePromptContext): string[] {
    const lines: string[] = [];
    lines.push('--- Info about you, the NPC ---');
    lines.push(..._toStaticNpcInfo(context.npc));
    lines.push('--- Info about the Player ---');
    lines.push(..._toPlayerInfo(context.player));
    lines.push('--- Memory / Extra Info ---');
    lines.push(..._toDynamicNpcInfo(context));
    return lines;
}

function _toStaticNpcInfo(npc: NpcTemplate): string[] {
    const info: string[] = [];
    info.push(`name: ${npc.name}`);
    if (npc.appearance.length > 0) {
        info.push(`appearance: ${npc.appearance.join(', ')}`);
    }
    if (npc.personality) {
        info.push(`personality: ${npc.personality}`);
    }
    if (npc.location) {
        info.push(`location: ${npc.location}`);
    }
    if (npc.goals) {
        info.push(`goals: ${npc.goals}.`);
    }
    if (npc.fears) {
        info.push(`fears: ${npc.fears}.`);
    }
    if (npc.likes) {
        info.push(`likes: ${npc.likes}`);
    }
    if (npc.dislikes) {
        info.push(`dislikes: ${npc.dislikes}`);
    }
    if (npc.abilities) {
        info.push(`abilities: ${npc.abilities}`);
    }
    if (npc.weaknesses) {
        info.push(`weaknesses: ${npc.weaknesses}.`);
    }
    return info;
}

function _toPlayerInfo(player: PlayerSnapshot): string[] {
    const info: string[] = [];
    info.push(`gender: ${player.static.gender}`);
    info.push(`race: ${player.static.race}`);
    info.push(`class: ${player.static.characterClass}`);
    info.push(`age: ${player.static.age}`);
    if (player.static.appearance.length > 0) {
        info.push(`appearance: ${player.static.appearance.join(', ')}`);
    }
    return info;
}

function _toDynamicNpcInfo(context: DialoguePromptContext): string[] {
    const info: string[] = [];
    info.push(`It is ${context.calendarString}`);
    if (context.dynamic.lastTimeSpokeAt === -1) {
        info.push('You have not talked to the player before.');
    } else {
        info.push(`Last spoke: ${context.timeDifference ?? 'some time ago'}`);
        if (context.dynamic.recollections.length > 0) {
            info.push(`Remember: '${context.dynamic.recollections.join(', ')}'`);
        }
    }
    return info;
}
