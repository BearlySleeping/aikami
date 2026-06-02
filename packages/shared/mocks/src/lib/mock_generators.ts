// packages/shared/mocks/src/lib/mock_generators.ts
import {
  BaseCharacterSheetSchema,
  MessageSchema,
  NotificationSchema,
  NpcSchema,
  PersonaSchema,
  UserSchema,
} from '@aikami/schemas';
import { Value } from 'typebox/value';

/**
 * Generate a structurally-valid mock User from the TypeBox schema.
 *
 * Uses `Value.Create` which produces a default-filled object (empty strings,
 * zeroes, empty arrays) that satisfies the schema shape. For tests that need
 * specific values, modify the returned object after generation.
 */
export const generateMockUser = () => Value.Create(UserSchema);

/**
 * Generate a structurally-valid mock character sheet.
 */
export const generateMockCharacter = () => Value.Create(BaseCharacterSheetSchema);

/**
 * Generate a structurally-valid mock NPC.
 */
export const generateMockNpc = () => Value.Create(NpcSchema);

/**
 * Generate a structurally-valid mock Persona.
 */
export const generateMockPersona = () => Value.Create(PersonaSchema);

/**
 * Generate a structurally-valid mock Message.
 */
export const generateMockMessage = () => Value.Create(MessageSchema);

/**
 * Generate a structurally-valid mock Notification.
 */
export const generateMockNotification = () => Value.Create(NotificationSchema);
