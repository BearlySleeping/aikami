import type { ChatData, NpcData } from '@aikami/types';
import { fromJsonData } from '@aikami/utils';
import { logger } from '$logger';
import type { PageLoad } from './$types';

export const load: PageLoad = (event) => {
  const { params, data } = event;
  logger.debug('/chat/[chatId]/+page.ts', { params, data });

  return {
    chat: fromJsonData<ChatData>(data.chat as Record<string, unknown>),
    npc: fromJsonData<NpcData>(data.npc as Record<string, unknown>),
  };
};
