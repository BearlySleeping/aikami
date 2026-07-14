// packages/shared/schemas/src/lib/database/branch.ts
import Type from 'typebox';

export const StoryBranchSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  uid: Type.String({ description: 'Owner user ID' }),
  name: Type.String({ description: 'Branch name' }),
  description: Type.String({ description: 'Branch description', default: '' }),
  parentBranchId: Type.Optional(Type.String()),
  chatId: Type.String({ description: 'Related chat ID' }),
  divergedAtMessageId: Type.String({ description: 'Message where branch split' }),
  isActive: Type.Boolean({ description: 'Is active branch', default: true }),
  createdAt: Type.String({ format: 'date-time', description: 'Creation timestamp' }),
  updatedAt: Type.String({ format: 'date-time', description: 'Last update timestamp' }),
});

export const BranchPointSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  chatId: Type.String({ description: 'Related chat ID' }),
  messageId: Type.String({ description: 'Message ID' }),
  choice: Type.String({ description: 'Chosen option' }),
  alternativeChoices: Type.Array(Type.String(), { description: 'Other options', default: [] }),
  branchId: Type.String({ description: 'Resulting branch ID' }),
});

export type StoryBranchData = Type.Static<typeof StoryBranchSchema>;
export type StoryBranch = Type.Static<typeof StoryBranchSchema>;
export type BranchPointData = Type.Static<typeof BranchPointSchema>;
export type BranchPoint = Type.Static<typeof BranchPointSchema>;
