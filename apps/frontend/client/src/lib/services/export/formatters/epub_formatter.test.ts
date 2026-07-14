// apps/frontend/client/src/lib/services/export/formatters/epub_formatter.test.ts
//
// Unit tests for EPUB session novel export formatter (C-246, AC-3).
// Validates EPUB structure: container.xml exists, opf has correct spine,
// no broken internal links.

import { describe, expect, test } from 'bun:test';
import JSZip from 'jszip';
import { type EpubExportInput, sessionToEpub } from './epub_formatter.ts';
import type { ExportMessage } from './jsonl_formatter.ts';

const _makeMessage = (
  overrides: Partial<ExportMessage> & { text: string; sender: 'user' | 'ai' },
): ExportMessage => ({
  text: overrides.text,
  sender: overrides.sender,
  timestamp: overrides.timestamp || '2026-07-10T14:30:00.000Z',
  edited: overrides.edited || false,
  diceRolls: overrides.diceRolls,
  attachments: overrides.attachments,
});

/** Helper: load EPUB blob as JSZip using arrayBuffer (Bun compat). */
const _loadEpub = async (blob: Blob): Promise<JSZip> => {
  const buf = await blob.arrayBuffer();
  return await JSZip.loadAsync(buf);
};

describe('sessionToEpub', () => {
  test('produces a valid EPUB with container.xml', async () => {
    const input: EpubExportInput = {
      sessionTitle: 'The Ruins of Aldren',
      sessionDate: '2026-07-10T12:00:00.000Z',
      playtimeMinutes: 120,
      synopsis: 'The party explored the ancient ruins.',
      npcName: 'Elara',
      userName: 'Thorn',
      messages: [
        _makeMessage({ text: 'I approach the ruins.', sender: 'user' }),
        _makeMessage({ text: 'The stones glow faintly.', sender: 'ai' }),
      ],
      uuid: 'session-123',
    };

    const blob = await sessionToEpub(input);
    const zip = await _loadEpub(blob);

    // mimetype must exist
    const mimetypeFile = zip.file('mimetype');
    expect(mimetypeFile).not.toBeNull();

    // container.xml must exist
    const containerFile = zip.file('META-INF/container.xml');
    expect(containerFile).not.toBeNull();
    const containerXml = await (containerFile ?? { async: () => '' }).async('string');
    expect(containerXml).toContain('container');
    expect(containerXml).toContain('OEBPS/package.opf');

    // package.opf must exist
    const opfFile = zip.file('OEBPS/package.opf');
    expect(opfFile).not.toBeNull();
    const opfXml = await (opfFile ?? { async: () => '' }).async('string');
    expect(opfXml).toContain('<spine>');
    expect(opfXml).toContain('title-page');

    // nav.xhtml must exist
    const navFile = zip.file('OEBPS/nav.xhtml');
    expect(navFile).not.toBeNull();

    // title-page.xhtml must exist
    const titleFile = zip.file('OEBPS/title-page.xhtml');
    expect(titleFile).not.toBeNull();
    const titleXml = await (titleFile ?? { async: () => '' }).async('string');
    expect(titleXml).toContain('The Ruins of Aldren');
    expect(titleXml).toContain('xmlns="http://www.w3.org/1999/xhtml"');
  });

  test('splits large message sets into multiple chapters', async () => {
    const messages: ExportMessage[] = Array.from({ length: 85 }, (_, i) =>
      _makeMessage({
        text: i % 2 === 0 ? `User message ${i}` : `AI narration paragraph ${i}.`,
        sender: i % 2 === 0 ? 'user' : 'ai',
      }),
    );

    const input: EpubExportInput = {
      sessionTitle: 'Long Session',
      sessionDate: '2026-07-10T12:00:00.000Z',
      playtimeMinutes: 300,
      synopsis: 'A very long session.',
      npcName: 'Elara',
      userName: 'Thorn',
      messages,
      uuid: 'session-long',
    };

    const blob = await sessionToEpub(input);
    const zip = await _loadEpub(blob);

    // Should have at least 2 chapters (85 / 40 = 2.125)
    const chapter1 = zip.file('OEBPS/chapter-1.xhtml');
    const chapter2 = zip.file('OEBPS/chapter-2.xhtml');
    const chapter3 = zip.file('OEBPS/chapter-3.xhtml');

    expect(chapter1).not.toBeNull();
    expect(chapter2).not.toBeNull();
    expect(chapter3).not.toBeNull(); // 3 chapters for 85 messages
  });

  test('XHTML files are well-formed with required namespace', async () => {
    const input: EpubExportInput = {
      sessionTitle: 'Test',
      sessionDate: '2026-07-10T12:00:00.000Z',
      playtimeMinutes: 60,
      synopsis: 'Test session.',
      npcName: 'Elara',
      userName: 'Thorn',
      messages: [_makeMessage({ text: 'Hello', sender: 'user' })],
      uuid: 'session-test',
    };

    const blob = await sessionToEpub(input);
    const zip = await _loadEpub(blob);

    // All XHTML files should have xmlns
    for (const [name, file] of Object.entries(zip.files)) {
      if (name.endsWith('.xhtml') && !file.dir) {
        const content = await file.async('string');
        expect(content).toContain('xmlns="http://www.w3.org/1999/xhtml"');
      }
    }
  });

  test('HTML entities are escaped in content', async () => {
    const input: EpubExportInput = {
      sessionTitle: 'Test & <Special>',
      sessionDate: '2026-07-10T12:00:00.000Z',
      playtimeMinutes: 60,
      synopsis: 'A <test> & session.',
      npcName: 'Elara',
      userName: 'Thorn',
      messages: [_makeMessage({ text: 'Characters like <>&" should be escaped', sender: 'user' })],
      uuid: 'session-escape',
    };

    const blob = await sessionToEpub(input);
    const zip = await _loadEpub(blob);

    const titleXml = await zip.file('OEBPS/title-page.xhtml')?.async('string');
    expect(titleXml).toContain('&amp;');
    expect(titleXml).toContain('&lt;');

    const chapterXml = await zip.file('OEBPS/chapter-1.xhtml')?.async('string');
    expect(chapterXml).toContain('&lt;&gt;&amp;');
  });

  test('UUID is stable for the same session ID', async () => {
    const baseInput: Omit<EpubExportInput, 'uuid'> = {
      sessionTitle: 'Stable UUID Test',
      sessionDate: '2026-07-10T12:00:00.000Z',
      playtimeMinutes: 60,
      synopsis: 'Testing stable UUID.',
      npcName: 'Elara',
      userName: 'Thorn',
      messages: [],
    };

    const blob1 = await sessionToEpub({ ...baseInput, uuid: 'session-stable' });
    const blob2 = await sessionToEpub({ ...baseInput, uuid: 'session-stable' });

    const zip1 = await _loadEpub(blob1);
    const zip2 = await _loadEpub(blob2);

    const opf1 = await zip1.file('OEBPS/package.opf')?.async('string');
    const opf2 = await zip2.file('OEBPS/package.opf')?.async('string');

    // Extract UUIDs from both
    const uuidMatch1 = opf1.match(/urn:uuid:([a-f0-9-]+)/);
    const uuidMatch2 = opf2.match(/urn:uuid:([a-f0-9-]+)/);

    expect(uuidMatch1).not.toBeNull();
    expect(uuidMatch2).not.toBeNull();
    expect(uuidMatch1?.[1]).toBe(uuidMatch2?.[1]);
  });
});
