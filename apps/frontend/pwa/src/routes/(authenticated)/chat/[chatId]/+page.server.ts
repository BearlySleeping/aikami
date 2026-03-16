import { chatRepository } from '@aikami/backend/database/chat';
import { npcRepository } from '@aikami/backend/database/npc';
import { toJsonData } from '@aikami/backend/utils/transform';
import { error } from '@sveltejs/kit';
import { logger } from '$logger';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { params, url } = event;
  logger.debug('/chat/[chatId]/+page.server.ts', { params });
  const { chatId } = params;
  const npcIdFromUrl = url.searchParams.get('npcId');

  let [chat, npc] = await Promise.all([
    chatRepository.getDocument({ chatId }),
    npcIdFromUrl && npcRepository.getDocument({ npcId: npcIdFromUrl }),
  ]);

  if (!chat) {
    error(404, { type: 'chat-not-found' });
  }

  if (!npc || chat.npcId !== npcIdFromUrl) {
    npc = await npcRepository.getDocument({ npcId: chat.npcId });
  }

  if (!npc) {
    error(404, { type: 'npc-not-found' });
  }

  return {
    chat: toJsonData(chat),
    npc: toJsonData(npc),
  };
};
