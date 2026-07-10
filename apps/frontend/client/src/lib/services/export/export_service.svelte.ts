// apps/frontend/client/src/lib/services/export/export_service.svelte.ts
//
// Export/Import service singleton (C-246).
// Orchestrates repository reads, format selection, Blob generation, and
// download triggering for all export operations.

import { AIKAMI_PNG_CHUNK_KEYWORD, EXPORT_FORMAT_VERSION } from '@aikami/constants';
import { chatRepository } from '@aikami/frontend/repositories/chat.ts';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type {
  AikamiCharacterCard,
  BackupManifest,
  ChatData,
  MessageData,
  NpcData,
  PersonaData,
} from '@aikami/types';
import { toAppError } from '@aikami/utils';
import JSZip from 'jszip';
import { authService, npcService, personaService, sessionService } from '$services';
import { createPlaceholderPngCard, embedCharacterInPng } from '../character/png_writer.ts';
import type { GameSession } from '../game/session_service.svelte';
import { sessionToEpub } from './formatters/epub_formatter.ts';
import { type ExportMessage, messagesToJsonl } from './formatters/jsonl_formatter.ts';
import { messagesToPlainText } from './formatters/plaintext_formatter.ts';

// ── Types ───────────────────────────────────────────────────────────────

export type ExportServiceOptions = BaseFrontendClassOptions;

export type ExportServiceInterface = BaseFrontendClassInterface & {
  /** Whether a backup operation is in progress. */
  readonly isBackingUp: boolean;
  /** Progress message during backup (e.g., "Exporting 3/5 chats..."). */
  readonly backupProgress: string;

  // ── Chat exports ──
  /** Lists all chats for the current user. */
  listChats(): Promise<ChatData[]>;
  /** Exports a single chat as JSONL and triggers browser download. */
  exportChatAsJsonl(options: { chat: ChatData; npcName?: string }): Promise<void>;
  /** Exports a single chat as plain text and triggers browser download. */
  exportChatAsPlainText(options: {
    chat: ChatData;
    npcName?: string;
    userName?: string;
  }): Promise<void>;

  // ── Session exports ──
  /** Lists all completed sessions for export. */
  listCompletedSessions(): GameSession[];
  /** Exports a session as an EPUB novel and triggers browser download. */
  exportSessionAsEpub(options: { session: GameSession }): Promise<void>;

  // ── Character exports ──
  /** Lists all characters (NPCs + personas) for the current user. */
  listExportableCharacters(): Promise<Array<NpcData | PersonaData>>;
  /** Exports a character as `.aikami.json` and triggers browser download. */
  exportCharacterAsJson(options: {
    character: NpcData | PersonaData;
    type: 'character' | 'npc' | 'persona';
  }): Promise<void>;
  /** Exports a character as `.aikami.png` card and triggers browser download. */
  exportCharacterAsPng(options: {
    character: NpcData | PersonaData;
    type: 'character' | 'npc' | 'persona';
  }): Promise<void>;

  // ── Bulk backup ──
  /** Exports all user data as a timestamped zip and triggers browser download. */
  exportBulkBackup(): Promise<void>;
};

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Converts a Firestore Timestamp-like value to ISO-8601 string.
 */
const _timestampToIso = (value: unknown): string => {
  if (!value) {
    return new Date().toISOString();
  }
  if (value instanceof Date) {
    try {
      return value.toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
};

/**
 * Extracts dice roll notation from message text.
 * Matches patterns like `[d20 = 17]`, `[2d6 = 9]`, `[d20 = 14 (success)]`.
 */
const _extractDiceRolls = (text: string): ExportMessage['diceRolls'] => {
  const pattern = /\[(\d*d\d+(?:\s*[+-]\s*\d+)?)\s*=\s*(\d+)\s*(?:\(([^)]*)\))?\]/g;
  const rolls: ExportMessage['diceRolls'] = [];
  let match = pattern.exec(text);
  while (match !== null) {
    rolls.push({
      notation: match[1].replace(/\s+/g, ''),
      result: Number.parseInt(match[2], 10),
      details: match[3] || '',
    });
    match = pattern.exec(text);
  }
  return rolls.length ? rolls : undefined;
};

/**
 * Converts Firestore MessageData to the normalized ExportMessage format.
 */
const _messageToExport = (message: MessageData, _index: number): ExportMessage => {
  return {
    text: message.text,
    sender: message.sender,
    timestamp: _timestampToIso(message.createdAt),
    edited: !!message.editedAt,
    branchId: message.regeneratedFrom,
    diceRolls: _extractDiceRolls(message.text),
    attachments: message.attachments?.map((a) => ({
      type: a.type as 'image' | 'file',
      url: a.url,
      name: a.name,
    })),
  };
};

/**
 * Sanitizes a file name for export — replaces path separators, truncates.
 */
const _sanitizeFileName = (name: string): string => {
  return name
    .replace(/[/\0]/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 100);
};

/**
 * Generates a date stamp for file names (YYYY-MM-DD).
 */
const _dateStamp = (): string => {
  return new Date().toISOString().split('T')[0];
};

/**
 * Triggers a browser download for a Blob or File.
 */
const _downloadBlob = (options: { blob: Blob; fileName: string }): void => {
  const { blob, fileName } = options;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

/**
 * Builds an AikamiCharacterCard from a character/persona object.
 */
const _buildCharacterCard = (options: {
  character: NpcData | PersonaData;
  type: 'character' | 'npc' | 'persona';
}): AikamiCharacterCard => {
  const { character, type } = options;
  // Extract the character sheet fields — NpcData and PersonaData both contain BaseCharacterSheet
  // plus their own extension fields (avatarUrl, voiceConfigId, etc.)
  const {
    id,
    createdAt,
    updatedAt,
    priority,
    uid,
    isActive,
    creatorUid,
    forkedFromNpcId,
    visibility,
    ...sheetFields
  } = character as Record<string, unknown>;

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    type,
    character: sheetFields as AikamiCharacterCard['character'],
    avatarUrl: (character as NpcData).avatarUrl,
    exportedAt: new Date().toISOString(),
    appVersion: '0.0.0', // TODO: read from package.json or env
  };
};

// ── Service ─────────────────────────────────────────────────────────────

class ExportService
  extends BaseFrontendClass<ExportServiceOptions>
  implements ExportServiceInterface
{
  isBackingUp = $state(false);
  backupProgress = $state('');

  // ── Chat ────────────────────────────────────────────────────────────

  async listChats(): Promise<ChatData[]> {
    return await chatRepository.getDocumentsByCollection(undefined);
  }

  async exportChatAsJsonl(options: { chat: ChatData; npcName?: string }): Promise<void> {
    const { chat } = options;
    const npcName = options.npcName || chat.npcName || 'Unknown';
    const messages = (chat.messages || []).map((m, i) => _messageToExport(m, i));
    const jsonl = messagesToJsonl({ messages });
    const blob = new Blob([jsonl], { type: 'application/jsonl' });
    const fileName = `chat-${_sanitizeFileName(npcName)}-${_dateStamp()}.jsonl`;
    _downloadBlob({ blob, fileName });
  }

  async exportChatAsPlainText(options: {
    chat: ChatData;
    npcName?: string;
    userName?: string;
  }): Promise<void> {
    const { chat, userName } = options;
    const npcName = options.npcName || chat.npcName || 'Unknown';
    const messages = (chat.messages || []).map((m, i) => _messageToExport(m, i));
    const text = messagesToPlainText({
      npcName,
      userName,
      exportedAt: new Date().toISOString(),
      messages,
    });
    const blob = new Blob([text], { type: 'text/plain' });
    const fileName = `chat-${_sanitizeFileName(npcName)}-${_dateStamp()}.txt`;
    _downloadBlob({ blob, fileName });
  }

  // ── Session ─────────────────────────────────────────────────────────

  listCompletedSessions(): GameSession[] {
    return sessionService.sessions.filter((s) => !s.isActive && s.summary);
  }

  async exportSessionAsEpub(options: { session: GameSession }): Promise<void> {
    const { session } = options;
    if (!session.summary) {
      throw toAppError({ errorType: 'invalid-argument', errorMessage: 'Session has no summary.' });
    }

    // TODO: Load messages for this session. For now, we generate a minimal EPUB.
    // In production, messages would come from the session's chat linkage.
    const messages: ExportMessage[] = [];

    const blob = await sessionToEpub({
      sessionTitle: `Session ${session.sessionNumber}`,
      sessionDate: session.startedAt,
      playtimeMinutes: session.durationMinutes || 0,
      synopsis: session.summary.synopsis,
      npcName: 'NPC',
      userName: 'Player',
      messages,
      uuid: session.id,
    });

    const fileName = `session-${session.sessionNumber}-${_dateStamp()}.epub`;
    _downloadBlob({ blob, fileName });
  }

  // ── Character ───────────────────────────────────────────────────────

  async listExportableCharacters(): Promise<Array<NpcData | PersonaData>> {
    const uid = authService.uid;
    if (!uid) {
      throw toAppError({ errorType: 'unauthenticated', errorMessage: 'User not logged in.' });
    }
    const [npcs, personas] = await Promise.all([
      npcService.getUserNpcs({ uid }),
      personaService.getPersonas(uid),
    ]);
    return [...npcs, ...personas];
  }

  async exportCharacterAsJson(options: {
    character: NpcData | PersonaData;
    type: 'character' | 'npc' | 'persona';
  }): Promise<void> {
    const card = _buildCharacterCard(options);
    const json = JSON.stringify(card, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const name = _sanitizeFileName(card.character.name || 'character');
    const ext = options.type === 'persona' ? 'aikami.json' : 'aikami.json';
    _downloadBlob({ blob, fileName: `${name}.${ext}` });
  }

  async exportCharacterAsPng(options: {
    character: NpcData | PersonaData;
    type: 'character' | 'npc' | 'persona';
  }): Promise<void> {
    const card = _buildCharacterCard(options);
    const json = JSON.stringify(card);
    const name = _sanitizeFileName(card.character.name || 'character');

    const avatarUrl = (options.character as NpcData).avatarUrl;

    if (avatarUrl) {
      try {
        const response = await fetch(avatarUrl);
        if (response.ok) {
          const avatarBlob = await response.blob();
          const pngBlob = await embedCharacterInPng({
            avatarBlob,
            characterJson: json,
          });
          _downloadBlob({ blob: pngBlob, fileName: `${name}.aikami.png` });
          return;
        }
      } catch {
        this.warn('exportCharacterAsPng: avatar fetch failed, using placeholder');
      }
    }

    // Fallback: placeholder PNG card
    const placeholderBlob = createPlaceholderPngCard({
      keyword: AIKAMI_PNG_CHUNK_KEYWORD,
      text: json,
    });
    _downloadBlob({ blob: placeholderBlob, fileName: `${name}.aikami.png` });
  }

  // ── Bulk backup ─────────────────────────────────────────────────────

  async exportBulkBackup(): Promise<void> {
    const uid = authService.uid;
    if (!uid) {
      throw toAppError({ errorType: 'unauthenticated', errorMessage: 'User not logged in.' });
    }

    this.isBackingUp = true;
    this.backupProgress = 'Preparing backup...';

    try {
      const zip = new JSZip();
      const manifest: BackupManifest = {
        formatVersion: EXPORT_FORMAT_VERSION,
        createdAt: new Date().toISOString(),
        appVersion: '0.0.0',
        chatCount: 0,
        characterCount: 0,
        totalMessages: 0,
        files: [],
      };

      // Export chats
      this.backupProgress = 'Exporting chats...';
      const chatFolder = zip.folder('chats');
      const chats = await this.listChats();
      manifest.chatCount = chats.length;

      for (let i = 0; i < chats.length; i++) {
        const chat = chats[i];
        this.backupProgress = `Exporting chat ${i + 1}/${chats.length}...`;
        const messages = (chat.messages || []).map((m, idx) => _messageToExport(m, idx));
        manifest.totalMessages += messages.length;

        const jsonl = messagesToJsonl({ messages });
        const fileName = `chat-${_sanitizeFileName(chat.npcName || 'unknown')}-${_dateStamp()}.jsonl`;
        chatFolder?.file(fileName, jsonl);
        manifest.files.push(`chats/${fileName}`);
      }

      // Export characters
      this.backupProgress = 'Exporting characters...';
      const charFolder = zip.folder('characters');
      const characters = await this.listExportableCharacters();
      manifest.characterCount = characters.length;

      for (const character of characters) {
        const isPersona = 'uid' in character && !('faction' in character);
        const type = isPersona ? ('persona' as const) : ('npc' as const);
        const card = _buildCharacterCard({ character, type });
        const json = JSON.stringify(card, null, 2);
        const name = _sanitizeFileName(card.character.name || 'character');
        const ext = isPersona ? 'aikami.json' : 'aikami.json';
        charFolder?.file(`${name}.${ext}`, json);
        manifest.files.push(`characters/${name}.${ext}`);
      }

      // Manifest
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));
      manifest.files.push('manifest.json');

      // Generate and download
      this.backupProgress = 'Creating archive...';
      const blob = await zip.generateAsync({ type: 'blob' });
      _downloadBlob({ blob, fileName: `aikami-backup-${_dateStamp()}.zip` });
    } finally {
      this.isBackingUp = false;
      this.backupProgress = '';
    }
  }
}

export const exportService: ExportServiceInterface = ExportService.create({
  className: 'ExportService',
});
