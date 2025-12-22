import type { Character, CharacterCardV1, CharacterCardV2 } from '$lib/types/character';
import { Buffer } from 'node:buffer';
import crc32 from 'npm:crc-32';

export class CharacterImporter {
    static async importFromPng(file: File): Promise<Character | null> {
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const textChunks = this.extractTextChunks(uint8Array);

        // Check for V3/V2 spec
        if (textChunks['ccv3']) {
            // TODO: Implement V3 parsing if needed, often similar to V2 but encoded differently
            // For now, let's see if we can find 'chara' which is usually present in V2
        }

        if (textChunks['chara']) {
            const decoded = new TextDecoder().decode(Buffer.from(textChunks['chara'], 'base64'));
            try {
                const json = JSON.parse(decoded);
                if (json.spec === 'chara_card_v2') {
                    return (json as CharacterCardV2).data;
                }
            } catch (e) {
                console.error('Failed to parse V2 character card', e);
            }
        }

        // Fallback? Some cards might be V1 encoded directly but usually 'chara' is the standard for V2.
        // V1 is often just implicit or different chunks? 
        // RisuAI checks `chara` chunk key.

        return null;
    }

    static async importFromJson(file: File): Promise<Character | null> {
        const text = await file.text();
        try {
            const json = JSON.parse(text);
            if (this.isCharacter(json)) {
                return json;
            }
            if (json.spec === 'chara_card_v2') {
                return (json as CharacterCardV2).data;
            }
            // Handle V1 JSONs
            if (json.name && json.description) {
                return this.convertV1ToV2(json);
            }
        } catch (e) {
            console.error("Failed to parse JSON character", e);
        }
        return null;
    }

    private static isCharacter(obj: any): obj is Character {
        return typeof obj.name === 'string' && typeof obj.first_mes === 'string';
    }

    private static convertV1ToV2(v1: any): Character {
        return {
            name: v1.name || '',
            description: v1.description || '',
            personality: v1.personality || '',
            scenario: v1.scenario || '',
            first_mes: v1.first_mes || '',
            mes_example: v1.mes_example || '',
            creator_notes: '',
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: [],
            tags: [],
            creator: '',
            character_version: '',
            extensions: {}
        };
    }

    private static extractTextChunks(data: Uint8Array): Record<string, string> {
        const chunks: Record<string, string> = {};
        let pos = 8; // Skip PNG header

        while (pos < data.length) {
            if (pos + 8 > data.length) break;

            const length = new DataView(data.buffer).getUint32(pos);
            const type = new TextDecoder().decode(data.slice(pos + 4, pos + 8));

            if (type === 'tEXt') {
                const chunkData = data.slice(pos + 8, pos + 8 + length);
                let separatorIndex = -1;
                for (let i = 0; i < chunkData.length; i++) {
                    if (chunkData[i] === 0) {
                        separatorIndex = i;
                        break;
                    }
                }

                if (separatorIndex !== -1) {
                    const key = new TextDecoder().decode(chunkData.slice(0, separatorIndex));
                    const value = new TextDecoder().decode(chunkData.slice(separatorIndex + 1));
                    chunks[key] = value;
                }
            }

            pos += 12 + length; // Length (4) + Type (4) + Data (length) + CRC (4)
        }

        return chunks;
    }
}
