import { describe, expect, test } from 'bun:test';
import { CharacterImporter } from './character-importer.ts';

describe('CharacterImporter', () => {
  describe('importFromJson', () => {
    test('should import valid character JSON', async () => {
      const characterJson = {
        name: 'Test Character',
        description: 'A test character',
        personality: 'Friendly',
        scenario: 'Test scenario',
        first_mes: 'Hello!',
        mes_example: 'Example message',
      };

      const file = new File([JSON.stringify(characterJson)], 'character.json', {
        type: 'application/json',
      });

      const result = await CharacterImporter.importFromJson(file);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Test Character');
      expect(result?.description).toBe('A test character');
      expect(result?.personality).toBe('Friendly');
      expect(result?.scenario).toBe('Test scenario');
      expect(result?.first_mes).toBe('Hello!');
      expect(result?.mes_example).toBe('Example message');
    });

    test('should import V2 character card format', async () => {
      const v2Card = {
        spec: 'chara_card_v2',
        data: {
          name: 'V2 Character',
          description: 'V2 description',
          personality: 'V2 personality',
          scenario: 'V2 scenario',
          first_mes: 'V2 greeting',
          mes_example: 'V2 example',
        },
      };

      const file = new File([JSON.stringify(v2Card)], 'character.json', {
        type: 'application/json',
      });

      const result = await CharacterImporter.importFromJson(file);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('V2 Character');
      expect(result?.description).toBe('V2 description');
    });

    test('should import V2 character card with nested data property', async () => {
      const v2Card = {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name: 'Nested Character',
          description: 'Nested description',
          personality: 'Nested personality',
          scenario: 'Nested scenario',
          first_mes: 'Nested greeting',
          mes_example: 'Nested example',
        },
      };

      const file = new File([JSON.stringify(v2Card)], 'character.json', {
        type: 'application/json',
      });

      const result = await CharacterImporter.importFromJson(file);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Nested Character');
    });

    test('should import RisuAI format', async () => {
      const risuAiCard = {
        name: 'RisuAI Character',
        description: 'RisuAI description',
        personality: 'RisuAI personality',
        scenario: 'RisuAI scenario',
        first_mes: 'RisuAI greeting',
        world_scenario: 'RisuAI world scenario',
      };

      const file = new File([JSON.stringify(risuAiCard)], 'character.json', {
        type: 'application/json',
      });

      const result = await CharacterImporter.importFromJson(file);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('RisuAI Character');
      expect(result?.scenario).toBe('RisuAI scenario');
    });

    test('should return null for invalid JSON', async () => {
      const file = new File(['invalid json'], 'character.json', {
        type: 'application/json',
      });

      const result = await CharacterImporter.importFromJson(file);

      expect(result).toBeNull();
    });

    test('should return null for non-character JSON', async () => {
      const nonCharacterJson = {
        foo: 'bar',
        baz: 123,
      };

      const file = new File([JSON.stringify(nonCharacterJson)], 'data.json', {
        type: 'application/json',
      });

      const result = await CharacterImporter.importFromJson(file);

      expect(result).toBeNull();
    });
  });

  describe('importFromJsonWithAvatar', () => {
    test('should return null when JSON is invalid', async () => {
      const file = new File(['invalid json'], 'character.json', {
        type: 'application/json',
      });

      const result = await CharacterImporter.importFromJsonWithAvatar(file);

      expect(result).toBeNull();
    });

    test('should import character without avatar when avatar not present', async () => {
      const characterData = {
        name: 'No Avatar Character',
        description: 'Character without avatar',
        personality: 'Test',
        scenario: 'Test',
        first_mes: 'Hello!',
        mes_example: 'Example',
      };

      const file = new File([JSON.stringify(characterData)], 'character.json', {
        type: 'application/json',
      });

      const result = await CharacterImporter.importFromJsonWithAvatar(file);

      expect(result).not.toBeNull();
      expect(result?.character.name).toBe('No Avatar Character');
      expect(result?.avatarFile).toBeUndefined();
    });
  });

  describe('importFromPng', () => {
    test('should return null for non-PNG files', async () => {
      const file = new File(['not a png'], 'character.txt', {
        type: 'text/plain',
      });

      const result = await CharacterImporter.importFromPng(file);

      expect(result).toBeNull();
    });

    test('should return null for PNG without character data', async () => {
      const minimalPng = new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG signature
        0x00,
        0x00,
        0x00,
        0x0d, // IHDR length
        0x49,
        0x48,
        0x44,
        0x52, // IHDR
        0x00,
        0x00,
        0x00,
        0x01, // width
        0x00,
        0x00,
        0x00,
        0x01, // height
        0x08,
        0x02,
        0x00,
        0x00,
        0x00, // bit depth, color type, etc
        0x90,
        0x77,
        0x53,
        0xde, // CRC
      ]);

      const file = new File([minimalPng], 'image.png', {
        type: 'image/png',
      });

      const result = await CharacterImporter.importFromPng(file);

      expect(result).toBeNull();
    });
  });

  describe('extractAvatarFromPng', () => {
    test('should extract avatar from valid PNG', async () => {
      const pngWithSignature = new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG signature
        0x00,
        0x00,
        0x00,
        0x0d, // IHDR length
        0x49,
        0x48,
        0x44,
        0x52, // IHDR
        0x00,
        0x00,
        0x00,
        0x01, // width
        0x00,
        0x00,
        0x00,
        0x01, // height
        0x08,
        0x02,
        0x00,
        0x00,
        0x00,
        0x90,
        0x77,
        0x53,
        0xde, // CRC
        0x00,
        0x00,
        0x00,
        0x0c, // IDAT length
        0x49,
        0x44,
        0x41,
        0x54, // IDAT
        0x08,
        0xd7,
        0x63,
        0x60,
        0x60,
        0x60,
        0x00,
        0x00,
        0x00,
        0x04,
        0x00,
        0x01,
        0x27,
        0x31,
        0x10,
        0x00, // CRC
        0x00,
        0x00,
        0x00,
        0x00, // IEND length
        0x49,
        0x45,
        0x4e,
        0x44, // IEND
        0xae,
        0x42,
        0x60,
        0x82, // CRC
      ]);

      const file = new File([pngWithSignature], 'character.png', {
        type: 'image/png',
      });

      const result = await CharacterImporter.extractAvatarFromPng(file);

      expect(result).not.toBeUndefined();
      expect(result?.type).toBe('image/png');
      expect(result?.name).toContain('character_avatar.png');
    });

    test('should return undefined for non-PNG file', async () => {
      const file = new File(['not a png'], 'character.txt', {
        type: 'text/plain',
      });

      const result = await CharacterImporter.extractAvatarFromPng(file);

      expect(result).toBeUndefined();
    });
  });

  describe('importFromPngWithAvatar', () => {
    test('should return null for PNG without character data', async () => {
      const pngWithChar = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
        0x77, 0x53, 0xde,
      ]);

      const file = new File([pngWithChar], 'character.png', {
        type: 'image/png',
      });

      const result = await CharacterImporter.importFromPngWithAvatar(file);

      expect(result).toBeNull();
    });
  });
});
