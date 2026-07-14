// apps/frontend/client/src/lib/views/dev/export_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for the Export & Data settings tab (C-246).
// Extends the production ExportViewModel and injects mock chats,
// characters, and sessions for isolated testing.

import type { ChatData } from '@aikami/types';
import {
  type ExportableCharacter,
  ExportViewModel,
  type ExportViewModelInterface,
  type ExportViewModelOptions,
} from '$views/settings/export/export_view_model.svelte';

export type ExportSandboxViewModelInterface = ExportViewModelInterface;

class ExportSandboxViewModel extends ExportViewModel implements ExportSandboxViewModelInterface {
  override async _loadData(): Promise<void> {
    this._injectMockData();
  }

  private _injectMockData(): void {
    // ── Mock chats ──
    this.chats = [
      {
        id: 'chat-1',
        npcName: 'Elara Nightwhisper',
        npcId: 'npc-1',
        uid: 'user-1',
        messages: Array.from({ length: 15 }, (_, i) => ({
          id: `msg-${i}`,
          text:
            i % 2 === 0
              ? `Player action ${i}`
              : `GM narration paragraph ${i}. The old stones hum faintly.`,
          sender: (i % 2 === 0 ? 'user' : 'ai') as 'user' | 'ai',
          createdAt: {
            toDate: () =>
              new Date(
                `2026-07-${String(10 - Math.floor(i / 2)).padStart(2, '0')}T14:${String(30 + i).padStart(2, '0')}:00Z`,
              ),
          },
          editedAt: i === 3 ? { toDate: () => new Date('2026-07-10T15:00:00Z') } : undefined,
          attachments:
            i === 7
              ? [
                  {
                    type: 'image' as const,
                    url: 'https://example.com/forest.png',
                    name: 'forest_path.png',
                  },
                ]
              : [],
        })),
        messageCount: 15,
        lastMessageAt: { toDate: () => new Date('2026-07-10T14:45:00Z') },
        visibility: 'private',
        affection: 5,
        stats: {},
      } as unknown as ChatData,
      {
        id: 'chat-2',
        npcName: 'Garrick Stonefist',
        npcId: 'npc-2',
        uid: 'user-1',
        messages: Array.from({ length: 8 }, (_, i) => ({
          id: `msg2-${i}`,
          text: i % 2 === 0 ? `Player turn ${i}` : `Dwarf's reply ${i}.`,
          sender: (i % 2 === 0 ? 'user' : 'ai') as 'user' | 'ai',
          createdAt: {
            toDate: () => new Date(`2026-07-09T${String(10 + i).padStart(2, '0')}:00:00Z`),
          },
        })),
        messageCount: 8,
        lastMessageAt: { toDate: () => new Date('2026-07-09T17:00:00Z') },
        visibility: 'private',
        affection: 3,
        stats: {},
      } as unknown as ChatData,
      {
        id: 'chat-3',
        npcName: 'Old Empty Chat',
        npcId: 'npc-3',
        uid: 'user-1',
        messages: [],
        messageCount: 0,
        visibility: 'private',
        affection: 0,
        stats: {},
      } as unknown as ChatData,
    ];

    // ── Mock characters ──
    this.characters = [
      {
        id: 'npc-elara',
        name: 'Elara Nightwhisper',
        type: 'npc' as const,
        avatarUrl: undefined,
        source: {
          id: 'npc-elara',
          name: 'Elara Nightwhisper',
          avatarUrl: undefined,
        } as Record<string, unknown> as ExportableCharacter['source'],
      },
      {
        id: 'npc-garrick',
        name: 'Garrick Stonefist',
        type: 'npc' as const,
        avatarUrl: undefined,
        source: {
          id: 'npc-garrick',
          name: 'Garrick Stonefist',
          avatarUrl: undefined,
        } as Record<string, unknown> as ExportableCharacter['source'],
      },
      {
        id: 'persona-thorn',
        name: 'Thorn Ironvein',
        type: 'persona' as const,
        avatarUrl: undefined,
        source: {
          id: 'persona-thorn',
          name: 'Thorn Ironvein',
          avatarUrl: undefined,
          uid: 'user-1',
        } as Record<string, unknown> as ExportableCharacter['source'],
      },
    ];

    // ── Mock sessions ──
    this.sessions = [
      {
        id: 'session-1',
        gameId: 'game-1',
        sessionNumber: 1,
        startedAt: '2026-07-09T10:00:00Z',
        endedAt: '2026-07-09T13:00:00Z',
        isActive: false,
        messageCount: 45,
        durationMinutes: 180,
        characterSnapshots: {},
        summary: {
          id: 'summary-1',
          createdAt: Date.now(),
          playtimeMinutes: 180,
          synopsis:
            'The party entered the Whispering Woods, discovered an ancient elven shrine, and fought a corrupted treant guardian.',
          keyEvents: ['Discovered ancient shrine', 'Defeated corrupted treant'],
          npcInteractions: [{ npcName: 'Elara', context: 'Translated shrine runes' }],
          resumePoint: 'Party rests at the shrine clearing.',
        },
      },
      {
        id: 'session-2',
        gameId: 'game-1',
        sessionNumber: 2,
        startedAt: '2026-07-10T14:00:00Z',
        endedAt: '2026-07-10T16:00:00Z',
        isActive: false,
        messageCount: 62,
        durationMinutes: 120,
        characterSnapshots: {},
        summary: {
          id: 'summary-2',
          createdAt: Date.now(),
          playtimeMinutes: 120,
          synopsis:
            'Explored the dwarven ruins beneath the shrine. Garrick identified a forge of legend.',
          keyEvents: ['Found legendary forge', 'Garrick repaired the anvil'],
          npcInteractions: [{ npcName: 'Garrick', context: 'Operated the ancient forge' }],
          resumePoint: 'Party exits the forge with newly crafted weapons.',
        },
      },
    ];
  }
}

export const getExportSandboxViewModel = (
  options: ExportViewModelOptions,
): ExportSandboxViewModelInterface => ExportSandboxViewModel.create(options);
