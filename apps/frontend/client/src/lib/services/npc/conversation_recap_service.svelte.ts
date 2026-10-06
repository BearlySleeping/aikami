// apps/frontend/client/src/lib/services/npc/conversation_recap_service.svelte.ts
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import {
  buildConversationRecap,
  CONVERSATION_RECAP_TAG,
} from '$lib/utils/journal/conversation_recap.ts';
import { campaignService } from '../campaign/campaign_service.svelte.ts';
import { playerJournalService } from '../game/player_journal_service.svelte.ts';

const DIARY_KEY = 'aikami:journal:diary-voice';

/** Recorder construction options. */
export type ConversationRecapServiceOptions = BaseFrontendClassOptions;

/** Device-only preference and deterministic conversation recording. No provider required. */
export type ConversationRecapServiceInterface = BaseFrontendClassInterface & {
  readonly diaryVoice: boolean;
  setDiaryVoice(value: boolean): void;
  recordConversation(options: {
    npcId: string;
    npcName: string;
    sessionNumber?: number;
    messages: ReadonlyArray<{ role: 'player' | 'npc'; content: string }>;
  }): Promise<void>;
};

/** Recorder instances restore the device preference at construction. */
class ConversationRecapService
  extends BaseFrontendClass<ConversationRecapServiceOptions>
  implements ConversationRecapServiceInterface
{
  diaryVoice = $state(false);

  constructor(options: ConversationRecapServiceOptions) {
    super(options);
    try {
      this.diaryVoice = localStorage.getItem(DIARY_KEY) === 'true';
    } catch {
      // Privacy mode: retain an in-memory preference, never block boot.
    }
  }

  setDiaryVoice(value: boolean): void {
    this.diaryVoice = value;
    try {
      localStorage.setItem(DIARY_KEY, String(value));
    } catch {
      this.warn('diary-preference:not-persisted');
    }
  }

  async recordConversation(options: {
    npcId: string;
    npcName: string;
    sessionNumber?: number;
    messages: ReadonlyArray<{ role: 'player' | 'npc'; content: string }>;
  }): Promise<void> {
    // Capture campaign and transcript BEFORE the first await. A delayed write
    // belongs to this campaign, never whichever campaign is active on arrival.
    const campaignId = campaignService.activeCampaign?.id;
    const recap = buildConversationRecap(options);
    if (!campaignId || !recap) {
      return;
    }
    try {
      await playerJournalService.createEntry({
        campaignId,
        sessionNumber: options.sessionNumber ?? 1,
        title: `Conversation with ${options.npcName}`.slice(0, 100),
        content: JSON.stringify(recap),
        tags: [CONVERSATION_RECAP_TAG, options.npcId],
      });
    } catch (error) {
      this.error('conversation-recap:write-failed', error);
    }
  }
}

/** Testable scoped factory; production owns one recorder through composition. */
export const createConversationRecapService = (
  options: ConversationRecapServiceOptions,
): ConversationRecapServiceInterface => ConversationRecapService.create(options);
