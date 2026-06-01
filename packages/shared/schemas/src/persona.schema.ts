// packages/shared/schemas/src/persona.schema.ts
import Type from 'typebox';

export const PersonaSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  race: Type.String({ minLength: 1 }),
  characterClass: Type.String({ minLength: 1 }),
  level: Type.Integer({ minimum: 1, maximum: 20 }),
  background: Type.String({ minLength: 1 }),
  attributes: Type.Object({
    strength: Type.Integer({ minimum: 1, maximum: 20 }),
    dexterity: Type.Integer({ minimum: 1, maximum: 20 }),
    constitution: Type.Integer({ minimum: 1, maximum: 20 }),
    intelligence: Type.Integer({ minimum: 1, maximum: 20 }),
    wisdom: Type.Integer({ minimum: 1, maximum: 20 }),
    charisma: Type.Integer({ minimum: 1, maximum: 20 }),
  }),
  proficiencies: Type.Array(Type.String(), { default: [] }),
});

export type Persona = Type.Static<typeof PersonaSchema>;
