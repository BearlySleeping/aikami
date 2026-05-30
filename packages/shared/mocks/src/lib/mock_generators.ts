import {
  BaseCharacterSheetSchema,
  MessageSchema,
  NotificationSchema,
  NpcSchema,
  PersonaSchema,
  UserSchema,
} from '@aikami/schemas';
import { zocker } from 'zocker';

export const generateMockUser = () => zocker(UserSchema).generate();

export const generateMockCharacter = () => zocker(BaseCharacterSheetSchema).generate();

export const generateMockNpc = () => zocker(NpcSchema).generate();

export const generateMockPersona = () => zocker(PersonaSchema).generate();

export const generateMockMessage = () => zocker(MessageSchema).generate();

export const generateMockNotification = () => zocker(NotificationSchema).generate();
