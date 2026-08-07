// GENERATED FILE — do not edit by hand.
// Source: apps/backend/firebase/dataconnect/schema/schema.gql (enums)
// Regenerate with: bun run generate:dataconnect-schemas (apps/backend/firebase)
// or: bun moon run firebase:generate-dataconnect-schemas

// Enum schemas use the GraphQL identifiers as emitted by the Data Connect
// SDK (e.g. PRIVATE, PUBLIC, USER, AI). NOT re-exported from @aikami/schemas
// — table row schemas inline these unions so they stay self-contained.
import Type from 'typebox';

export const VisibilitySchema = Type.Union([Type.Literal('PRIVATE'), Type.Literal('PUBLIC')]);
export type VisibilityData = Type.Static<typeof VisibilitySchema>;
export type Visibility = Type.Static<typeof VisibilitySchema>;

export const SenderSchema = Type.Union([Type.Literal('USER'), Type.Literal('AI')]);
export type SenderData = Type.Static<typeof SenderSchema>;
export type Sender = Type.Static<typeof SenderSchema>;

export const UserRoleSchema = Type.Union([Type.Literal('MEMBER'), Type.Literal('SUPER_ADMIN')]);
export type UserRoleData = Type.Static<typeof UserRoleSchema>;
export type UserRole = Type.Static<typeof UserRoleSchema>;

export const NotificationTypeSchema = Type.Union([Type.Literal('CHAT_MESSAGE'), Type.Literal('SYSTEM')]);
export type NotificationTypeData = Type.Static<typeof NotificationTypeSchema>;
export type NotificationType = Type.Static<typeof NotificationTypeSchema>;
