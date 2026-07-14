// packages/shared/types/src/lib/database/chat_link.ts
//
// Derived TypeScript types for the ChatLink Firestore document.
// Single source of truth: ChatLinkSchema in @aikami/schemas.
//
// Contract: C-244 Connected Chats Cross-Mode Bridge

import type { ChatLinkSchema } from '@aikami/schemas';
import type { Static } from 'typebox';

export type ChatLink = Static<typeof ChatLinkSchema>;
