import { beforeEach, describe, expect, test } from 'bun:test';
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
});
