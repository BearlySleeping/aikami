// packages/shared/schemas/src/lib/database/appearance.ts
import Type from 'typebox';

export const AppearanceSchema = Type.Object({
  avatarUrl: Type.Optional(
    Type.String({ format: 'uri', description: 'URL to the character avatar image' }),
  ),
  portraitUrl: Type.Optional(
    Type.String({ format: 'uri', description: 'URL to the character portrait' }),
  ),
  physicalDescription: Type.Optional(
    Type.String({ description: 'Physical description of the character' }),
  ),
  age: Type.Optional(Type.String({ description: 'Character age' })),
  height: Type.Optional(Type.String({ description: 'Character height' })),
  weight: Type.Optional(Type.String({ description: 'Character weight' })),
  eyeColor: Type.Optional(Type.String({ description: 'Eye color' })),
  hairColor: Type.Optional(Type.String({ description: 'Hair color' })),
  skinColor: Type.Optional(Type.String({ description: 'Skin color' })),
  distinguishingMarks: Type.Optional(
    Type.String({ description: 'Scars, tattoos, or other distinguishing marks' }),
  ),
});

export type AppearanceData = Type.Static<typeof AppearanceSchema>;
