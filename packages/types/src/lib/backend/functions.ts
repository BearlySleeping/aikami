import type { UserData } from '../database/user.ts';

export type CallableFunctions = {
  generateImage: [
    {
      prompt: string;
      npcId?: string;
      characterId?: string;
    },
    {
      imageUrl: string;
    },
  ];
};

export type RequestFunctions = {
  prompt_ai: [
    {
      prompt: string;
    },
    (
      | {
          chatResponse: unknown;
          user?: UserData;
        }
      | unknown
    ),
  ];
};
