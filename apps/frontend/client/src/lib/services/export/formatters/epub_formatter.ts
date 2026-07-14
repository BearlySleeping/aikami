// apps/frontend/client/src/lib/services/export/formatters/epub_formatter.ts
//
// EPUB 3.0 session novel export formatter (AC-3).
// Converts a completed game session with messages into a valid EPUB 3.0
// container — XHTML chapters, nav, container.xml, package.opf.

import JSZip from 'jszip';
import type { ExportMessage } from './jsonl_formatter.ts';

/**
 * Input for the EPUB formatter.
 */
export type EpubExportInput = {
  /** Session title. */
  sessionTitle: string;
  /** Session date (ISO-8601). */
  sessionDate: string;
  /** Playtime in minutes. */
  playtimeMinutes: number;
  /** Session synopsis. */
  synopsis: string;
  /** NPC character name for dialogue attribution. */
  npcName: string;
  /** User persona name. */
  userName: string;
  /** The messages to format as the novel. */
  messages: ExportMessage[];
  /** Stable UUID derived from the session ID. */
  uuid: string;
};

/**
 * Maximum messages per chapter before splitting.
 */
const MESSAGES_PER_CHAPTER = 40;

/**
 * Escapes text for safe XHTML inclusion.
 */
const _escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Derives a stable RFC 4122 UUIDv4-style string from a session ID.
 * Not cryptographically random — deterministic from the session ID so
 * the EPUB identifier is stable across re-exports.
 */
const _uuidFromSessionId = (sessionId: string): string => {
  // Simple hash for deterministic UUID-like string
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    const char = sessionId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit int
  }
  const hex = (Math.abs(hash) % 0xffffffff).toString(16).padStart(8, '0');
  return `${hex.slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(4, 7)}-a${hex.slice(5, 8)}-${hex}${hex.slice(0, 4)}`;
};

/**
 * Splits messages into chapter groups, attempting to split on paragraph breaks
 * around the target chapter size.
 */
const _splitIntoChapters = (messages: ExportMessage[]): ExportMessage[][] => {
  const chapters: ExportMessage[][] = [];
  let start = 0;

  while (start < messages.length) {
    let end = Math.min(start + MESSAGES_PER_CHAPTER, messages.length);

    // Walk back to find a paragraph break (empty text or ends with \n\n)
    if (end < messages.length) {
      for (let i = Math.max(start, end - 10); i < end; i++) {
        const text = messages[i]?.text ?? '';
        if (text.trim() === '' || text.endsWith('\n\n') || text.includes('\n\n')) {
          end = i + 1;
          break;
        }
      }
    }

    chapters.push(messages.slice(start, end));
    start = end;
  }

  return chapters;
};

/**
 * Renders a single message as XHTML.
 */
const _renderMessage = (options: {
  message: ExportMessage;
  npcName: string;
  userName: string;
}): string => {
  const { message, npcName, userName } = options;
  const senderName = message.sender === 'ai' ? npcName : userName;
  const parts: string[] = [];

  if (message.sender === 'ai') {
    // AI narration as prose paragraph
    if (message.text) {
      parts.push(`<p class="narration">${_escapeXml(message.text)}</p>`);
    }
  } else {
    // User dialogue as quoted block
    if (message.text) {
      parts.push(`<blockquote class="dialogue" data-speaker="${_escapeXml(senderName)}">
        <p>${_escapeXml(message.text)}</p>
      </blockquote>`);
    }
  }

  // Dice rolls
  if (message.diceRolls?.length) {
    for (const roll of message.diceRolls) {
      const detail = roll.details ? ` (${_escapeXml(roll.details)})` : '';
      parts.push(
        `<p class="dice-roll">🎲 ${_escapeXml(roll.notation)} = ${roll.result}${detail}</p>`,
      );
    }
  }

  return parts.join('\n');
};

/**
 * Generates the XHTML for the title page.
 */
const _generateTitlePage = (options: EpubExportInput): string => {
  const { sessionTitle, sessionDate, playtimeMinutes, synopsis } = options;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${_escapeXml(sessionTitle)}</title>
  <style type="text/css">
    body { font-family: serif; margin: 2em; line-height: 1.6; }
    h1 { text-align: center; margin-bottom: 0.5em; }
    .meta { text-align: center; color: #666; margin-bottom: 2em; }
    .synopsis { font-style: italic; margin-top: 2em; }
  </style>
</head>
<body>
  <h1>${_escapeXml(sessionTitle)}</h1>
  <div class="meta">
    <p>${_escapeXml(sessionDate.split('T')[0])}</p>
    <p>Playtime: ${playtimeMinutes} minutes</p>
  </div>
  <div class="synopsis">
    <p>${_escapeXml(synopsis)}</p>
  </div>
</body>
</html>`;
};

/**
 * Generates the XHTML for a single chapter.
 */
const _generateChapter = (options: {
  chapterIndex: number;
  messages: ExportMessage[];
  npcName: string;
  userName: string;
}): string => {
  const { chapterIndex, messages, npcName, userName } = options;
  const bodyParts = messages.map((msg) => _renderMessage({ message: msg, npcName, userName }));

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Chapter ${chapterIndex + 1}</title>
  <style type="text/css">
    body { font-family: serif; margin: 1.5em; line-height: 1.6; }
    h2 { text-align: center; margin-bottom: 1.5em; }
    .narration { text-indent: 1.5em; margin: 0.5em 0; }
    .dialogue { margin: 0.75em 2em; font-style: italic; border-left: 2px solid #ccc; padding-left: 1em; }
    .dialogue::before { content: attr(data-speaker) " —"; font-style: normal; font-weight: bold; display: block; margin-bottom: 0.25em; }
    .dice-roll { font-family: monospace; font-size: 0.9em; color: #666; margin: 0.25em 0; }
  </style>
</head>
<body>
  <h2>Chapter ${chapterIndex + 1}</h2>
${bodyParts.join('\n')}
</body>
</html>`;
};

/**
 * Generates the EPUB navigation document (nav.xhtml).
 */
const _generateNav = (options: { sessionTitle: string; chapterCount: number }): string => {
  const { chapterCount } = options;
  const chapterLinks = Array.from(
    { length: chapterCount },
    (_, i) => `    <li><a href="chapter-${i + 1}.xhtml">Chapter ${i + 1}</a></li>`,
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Table of Contents</title>
</head>
<body>
  <nav epub:type="toc">
    <h1>Table of Contents</h1>
    <ol>
      <li><a href="title-page.xhtml">Title Page</a></li>
${chapterLinks}
    </ol>
  </nav>
  <nav epub:type="landmarks" hidden="">
    <ol>
      <li><a epub:type="cover" href="title-page.xhtml">Cover</a></li>
    </ol>
  </nav>
</body>
</html>`;
};

/**
 * Generates the EPUB container.xml file.
 */
const _CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

/**
 * Generates the EPUB package.opf metadata file.
 */
const _generatePackageOpf = (options: {
  uuid: string;
  sessionTitle: string;
  sessionDate: string;
  chapterCount: number;
}): string => {
  const { uuid, sessionTitle, sessionDate } = options;
  const chapterItems = Array.from(
    { length: options.chapterCount },
    (_, i) =>
      `    <item id="chapter-${i + 1}" href="chapter-${i + 1}.xhtml" media-type="application/xhtml+xml"/>`,
  ).join('\n');
  const chapterRefs = Array.from(
    { length: options.chapterCount },
    (_, i) => `    <itemref idref="chapter-${i + 1}"/>`,
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${_escapeXml(sessionTitle)}</dc:title>
    <dc:date>${_escapeXml(sessionDate.split('T')[0])}</dc:date>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${_escapeXml(sessionDate)}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="title-page" href="title-page.xhtml" media-type="application/xhtml+xml"/>
${chapterItems}
  </manifest>
  <spine>
    <itemref idref="title-page"/>
${chapterRefs}
  </spine>
</package>`;
};

/**
 * Converts a completed game session into an EPUB 3.0 Blob.
 *
 * @returns An EPUB file as a Blob with mime type `application/epub+zip`.
 */
export const sessionToEpub = async (options: EpubExportInput): Promise<Blob> => {
  const { sessionTitle, sessionDate, messages, npcName, userName } = options;

  // Derive UUID from input to keep it stable per session
  const uuid = _uuidFromSessionId(options.uuid);

  // Split into chapters
  const chapterGroups = _splitIntoChapters(messages);

  const zip = new JSZip();

  // mimetype — MUST be first, uncompressed
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // META-INF/container.xml
  zip.file('META-INF/container.xml', _CONTAINER_XML);

  // OEBPS/package.opf
  zip.file(
    'OEBPS/package.opf',
    _generatePackageOpf({
      uuid,
      sessionTitle,
      sessionDate,
      chapterCount: chapterGroups.length,
    }),
  );

  // OEBPS/nav.xhtml
  zip.file('OEBPS/nav.xhtml', _generateNav({ sessionTitle, chapterCount: chapterGroups.length }));

  // OEBPS/title-page.xhtml
  zip.file('OEBPS/title-page.xhtml', _generateTitlePage(options));

  // OEBPS/chapter-N.xhtml
  for (let i = 0; i < chapterGroups.length; i++) {
    zip.file(
      `OEBPS/chapter-${i + 1}.xhtml`,
      _generateChapter({
        chapterIndex: i,
        messages: chapterGroups[i],
        npcName,
        userName,
      }),
    );
  }

  return await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
};
