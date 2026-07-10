## Metadata

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/README.md` (Export & Data section — JSONL/plaintext chats, bulk transcript zips, SillyTavern import), `docs/FRONTEND.md` (export/import endpoints, `ImportCharacterModal`, `STBulkImportModal`, character PNG/JSON import), `docs/CONFIGURATION.md` (Backups, Profiles, Bulk Import — `ADMIN_SECRET`, `IMPORT_ALLOWED_ROOTS`, profile export redacts secrets); TODO.md C-ME-017 |
| **Target** | `apps/frontend/client/src/lib/services/export/` + `apps/frontend/client/src/lib/views/settings/export/` — Export/import service layer, format generators, settings UI |
| **Priority** | P2 — Medium complexity, medium impact. Enables sharing, backup, and "read your adventure as a book" |
| **Dependencies** | C-231 (Rich Chat — COMPLETED for message data model), C-232 (Character Sheet — COMPLETED for character schema), C-240 (Session Management — COMPLETED for `SessionSummary`), `FirestoreRepository` pattern (EXISTING), `StorageService` for avatar downloads (EXISTING), `character_importer.ts` (EXISTING), `character_downloader.ts` (EXISTING) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Aikami already has a character importer (Chub, Risu, generic URLs), a Firebase Storage service, and comprehensive TypeBox schemas for characters, chats, and messages — but has no export functionality at all. Marinara-Engine provides a full export/import surface: individual chat export as JSONL or plain text, bulk transcript zips, SillyTavern bulk import, character card PNG/JSON import, and full backup archives. This contract adds three export formats (JSONL, plain text prose, EPUB novel), a character export format (`.aikami.json` + PNG with embedded metadata), a bulk backup zip, and the settings UI to trigger them all. Import enhancements extend the existing `character_importer.ts` with PNG metadata extraction.

## Design Reference

**Existing code to extend:**
- `apps/frontend/client/src/lib/services/character/character_importer.ts` — existing character card import (PNG blob → File)
- `apps/frontend/client/src/lib/services/character/character_downloader.ts` — URL-based character download (Risu, Chub, generic)
- `apps/frontend/client/src/lib/services/storage/storage_service.svelte.ts` — `uploadAvatar()` for Firebase Storage
- `packages/shared/schemas/src/lib/database/character.ts` — `BaseCharacterSheetSchema` (full D&D sheet — 20+ fields)
- `packages/shared/schemas/src/lib/database/chat.ts` — `ChatSchema` (npcId, uid, messages[], stats, affection)
- `packages/shared/schemas/src/lib/database/message.ts` — `MessageSchema` (text, sender, editedAt, attachments, metadata)
- `packages/shared/schemas/src/lib/database/branch.ts` — `StoryBranchSchema`, `BranchPointSchema`
- `apps/frontend/client/src/lib/services/chat/chat.svelte.ts` — `chatService` singleton with chat CRUD
- `apps/frontend/client/src/lib/views/settings/` — existing settings tab structure

**Marinara-Engine inspiration:**
- Export format: `examples/Marinara-Engine/docs/README.md` — "Export & Data" section: JSONL + plain text, bulk transcript zips
- Import: `examples/Marinara-Engine/docs/FRONTEND.md` — `ImportCharacterModal` (JSON/PNG), `STBulkImportModal` (SillyTavern bulk)
- Backup admin: `examples/Marinara-Engine/docs/CONFIGURATION.md` — `ADMIN_SECRET` for privileged ops, `IMPORT_ALLOWED_ROOTS`, backup create/download/delete
- Profile export: `examples/Marinara-Engine/docs/CONFIGURATION.md` — profile export/import with secret redaction
- API routes: `examples/Marinara-Engine/docs/FRONTEND.md` — `/api/backup`, `/api/import/*` endpoints

**Testing conventions:** See `.pi/skills/testing/SKILL.md`.

## Architecture Directives

- **Export service**: New singleton `exportService` in `apps/frontend/client/src/lib/services/export/export_service.svelte.ts`. Exposes `exportChatAsJsonl()`, `exportChatAsPlainText()`, `exportCharacterAsFile()`, `exportSessionAsEpub()`, `exportBulkBackup()`. All methods are pure data transforms — they read from existing repositories and return `Blob` or `File` objects for the browser's download API.
- **Format generators**: Pure utility functions in `apps/frontend/client/src/lib/services/export/formatters/`:
    - `jsonl_formatter.ts` — `chatToJsonl(messages, metadata): string` (one JSON object per line)
    - `plaintext_formatter.ts` — `chatToProse(messages): string` (readable script-style formatting with character names)
    - `epub_formatter.ts` — `sessionToEpub(sessionSummary, messages): Blob` (EPUB 3.0 container with XHTML chapters)
- **Character export**: Extend `character_importer.ts` with PNG metadata writing. Use a `tEXt` chunk in the PNG to embed the character JSON. Export format: `.aikami.json` (standalone) or `.aikami.png` (card with embedded metadata).
- **Bulk backup**: Client-side zip using `JSZip` (add via `direnv_add_package` or npm dependency). Zips all chat JSONL files + character `.aikami.json` files + lorebook exports + world state snapshot into a single timestamped archive.
- **Settings UI**: New "Export & Data" tab in settings (`apps/frontend/client/src/lib/views/settings/export/`). Per-chat export buttons, character export, bulk backup download, and import enhancement.

## State & Data Models

**JSONL message line** — one line per message in the export:

```typescript
interface JsonlMessageLine {
    /** Message index in the chat (0-based). */
    index: number;
    /** Timestamp of the message. */
    timestamp: string;
    /** Sender role: 'user' | 'ai'. */
    role: string;
    /** The message text content. */
    content: string;
    /** Whether this message was edited. */
    edited: boolean;
    /** Branch/swipe info if this is an alternate. */
    branchId?: string;
    /** Dice roll metadata from the message. */
    diceRolls?: Array<{
        notation: string;
        result: number;
        details: string;
    }>;
    /** Attachments (image URLs, file names). */
    attachments?: Array<{
        type: string;
        url: string;
        name?: string;
    }>;
}
```

**Aikami character card** — the `.aikami.json` export format:

```typescript
interface AikamiCharacterCard {
    /** Format version for forward compatibility. */
    formatVersion: '1.0.0';
    /** Type discriminator. */
    type: 'character' | 'npc' | 'persona';
    /** Full character sheet (TypeBox schema). */
    character: BaseCharacterSheet;
    /** Avatar URL for re-download. */
    avatarUrl?: string;
    /** Embedded avatar as base64 data URI (optional, for offline portability). */
    avatarBase64?: string;
    /** Exported at timestamp. */
    exportedAt: string;
    /** App version that generated this export. */
    appVersion: string;
}
```

**Bulk backup manifest** — `manifest.json` inside the zip:

```typescript
interface BackupManifest {
    /** Format version. */
    formatVersion: '1.0.0';
    /** Timestamp of backup creation. */
    createdAt: string;
    /** App version. */
    appVersion: string;
    /** Number of chats included. */
    chatCount: number;
    /** Number of characters included. */
    characterCount: number;
    /** Total message count across all chats. */
    totalMessages: number;
    /** File listing inside the zip. */
    files: string[];
}
```

## Scope Boundaries

- **In Scope:**
    - JSONL chat export — one JSON object per message, full metadata
    - Plain text prose export — script-style formatting with roles, timestamps, dice results
    - EPUB session novel export — chapters from session messages, narration + dialogue formatting
    - Character export as `.aikami.json` (full TypeBox schema)
    - Character export as PNG card with JSON embedded in `tEXt` chunk
    - Bulk backup zip — all chats + characters + manifest
    - "Export & Data" settings tab with per-chat/per-character export buttons
    - Import enhancement — PNG metadata extraction for character cards
- **Out of Scope:**
    - SillyTavern bulk import (Marinara specific — Aikami has its own format)
    - Lorebook export/import (depends on C-ME-009 lorebook system)
    - World state export/import (depends on C-ME-006 GM world state)
    - Agent definition export/import (depends on C-ME-018 custom agents)
    - Prompt preset export/import (depends on C-ME-008 macro system)
    - Server-side backup (Firebase has its own backup; this is client-side)
    - OAuth-secured remote backup (Marinara `ADMIN_SECRET` pattern)
    - Cloud sync / Google Drive / iCloud backup targets

## Acceptance Criteria

### AC-1: JSONL Chat Export
**Given** a chat with 15 messages (8 user, 7 AI), including 1 edited message, 2 dice rolls (`[d20 = 17]`, `[2d6 = 9]`), and 1 image attachment
**When** the user clicks "Export as JSONL" on that chat in settings
**Then** a `.jsonl` file downloads containing 15 lines (one per message). Each line is a valid JSON object with `index`, `timestamp`, `role`, `content`, `edited`, and optional `diceRolls` / `attachments`. The edited message has `edited: true`. The file name is `chat-{npcName}-{date}.jsonl`.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test at `apps/frontend/client/src/lib/services/export/formatters/jsonl_formatter.test.ts` — mock messages, verify JSONL output
- E2E / Visual:
    - **Functional**: `tests/client/export-jsonl.spec.ts` — export chat, verify download file contents
    - **Visual**: N/A

**Watch Points**:
- Messages with special characters (`"`, `\n`, emoji) must be properly JSON-escaped
- Empty chats (0 messages) export as an empty file (0 bytes), not a file with `[]`
- Dice roll details like `(4,5)` must be extracted from message content or metadata

### AC-2: Plain Text Prose Export
**Given** the same 15-message chat
**When** "Export as Plain Text" is clicked
**Then** a `.txt` file downloads with script-style formatting:

```
=== Chat with Elara Nightwhisper ===
Exported 2026-07-10

[User, 14:30]
I approach the ancient ruins cautiously.

[Elara Nightwhisper, 14:31]
*The elf looks up from her map* These ruins predate the kingdom itself. Watch your step.

[User, 14:32]
I cast Detect Magic. Do I sense anything?
🎲 d20 = 17 (success)
...
```

Dice rolls appear inline as `🎲` markers. Attachments show as `[Image: forest_path.png]`. Edited messages show `(edited)`.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test at `apps/frontend/client/src/lib/services/export/formatters/plaintext_formatter.test.ts`
- E2E / Visual:
    - **Functional**: `tests/client/export-plaintext.spec.ts` — export, verify prose format
    - **Visual**: N/A

**Watch Points**:
- NPC name must be resolved from `npcName` field in ChatSchema, not hardcoded
- User persona name (e.g., "Thorn Ironvein") should replace "User" if available
- Very long messages (1000+ chars) should not break formatting — prose wrap only, no truncation

### AC-3: EPUB Session Novel Export
**Given** a completed game session (C-240) with `SessionSummary` containing synopsis + resume point, and 200 messages of narration + dialogue
**When** "Export as EPUB Novel" is clicked in the session browser
**Then** an `.epub` file downloads that is a valid EPUB 3.0 container. Contents:
- `title-page.xhtml` — session title, date, playtime, synopsis
- `chapter-1.xhtml` through `chapter-N.xhtml` — messages split into chapters of ~40 messages each, with AI narration as prose paragraphs and dialogue as indented quoted blocks
- `nav.xhtml` — table of contents with chapter links
- `container.xml`, `package.opf` — valid EPUB container metadata

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test — `epub_formatter.test.ts` validates EPUB structure (container.xml exists, opf has correct spine, no broken internal links)
- E2E / Visual:
    - **Functional**: `tests/client/export-epub.spec.ts` — export EPUB, unzip, validate structure
    - **Visual**: N/A

**Watch Points**:
- EPUB must pass `epubcheck` validation (at minimum: valid XML, all manifest items referenced, no broken spine refs)
- HTML entities in XHTML (`&`, `<`, `>`) must be escaped
- Chapter splitting must not cut mid-sentence — split on the nearest paragraph break after ~40 messages
- Large sessions (1000+ messages) must produce multiple chapter files without memory issues
- UTF-8 encoding for all files; emoji in dialogue must render correctly in e-readers

### AC-4: Character Export — JSON + PNG Card
**Given** a fully authored character with ability scores, class, equipment, narrative traits, and an avatar image
**When** "Export Character" is clicked and "Aikami JSON" format is selected
**Then** a `.aikami.json` file downloads containing the full `AikamiCharacterCard` with all character fields, `formatVersion: "1.0.0"`, `exportedAt`, and `appVersion`.
**When** "PNG Card" format is selected
**Then** a `.png` file downloads that (a) displays the character avatar as the image, and (b) embeds the full `AikamiCharacterCard` JSON in a `tEXt` chunk with keyword `aikami_character`. The PNG can be re-imported by drag-and-drop.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test — verify JSON round-trip (export → parse → validate against TypeBox schema). Verify PNG chunk extraction (write `tEXt` chunk, read back, parse JSON).
- E2E / Visual:
    - **Functional**: `tests/client/export-character.spec.ts` — export both formats, verify file contents, re-import PNG card
    - **Visual**: N/A

**Watch Points**:
- PNG `tEXt` chunk keyword must be exactly `aikami_character` (lowercase, snake_case)
- Avatar base64 must be optional — large avatars (5MB+) should omit base64 to keep file size manageable
- Importing a `.aikami.json` from a future `formatVersion` must show a clear error ("This card requires Aikami v2.0 or later"), not a crash

### AC-5: Bulk Backup Zip
**Given** the user has 5 chats, 3 characters, and 2 personas
**When** "Download Backup" is clicked in Export settings
**Then** a `aikami-backup-{date}.zip` file downloads containing:
```
manifest.json
chats/
  chat-elara-2026-07-10.jsonl
  chat-garrick-2026-07-09.jsonl
  ...
characters/
  elara-nightwhisper.aikami.json
  garrick-stonefist.aikami.png
  ...
personas/
  thorn-ironvein.aikami.json
```
The manifest includes counts and file listing. Each JSON file round-trips through its TypeBox schema validation.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test — create mock chats + characters, call `exportBulkBackup()`, unzip blob, verify structure + manifest accuracy
- E2E / Visual:
    - **Functional**: `tests/client/export-backup.spec.ts` — backup download, zip inspection, manifest validation
    - **Visual**: N/A

**Watch Points**:
- Backup must not include Firebase internal fields (`__name__`, `createTime`, `updateTime`) in exported data
- File names must be sanitized — `/` and `\0` replaced with `-`, max 100 chars
- If a character has no avatar, the PNG card export falls back to a generated placeholder silhouette
- Backup creation must be async with a progress indicator — 100+ chats could take seconds

### AC-6: Export & Data Settings Tab
**Given** the settings page is open
**When** the user navigates to the "Export & Data" tab
**Then** the UI shows:
- **Chat Export section**: list of all chats with name, NPC, message count, last activity. Each row has "JSONL" and "Plain Text" download buttons.
- **Character Export section**: list of all characters/personas with name, type badge. Each row has "Aikami JSON" and "PNG Card" download buttons.
- **Session Export section**: list of completed sessions with date and synopsis preview. "EPUB" download button per session.
- **Bulk Backup section**: "Download Backup" button with estimated size and last backup date.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Navigate to settings → Export tab, verify sections render with mock data
- E2E / Visual:
    - **Functional**: `tests/client/export-settings-ui.spec.ts` — verify tab navigation, button presence, download triggers
    - **Visual**: `suites/export-settings-ui.visual.ts` — Screenshot the full Export tab with chat/character/session/backup sections

**Watch Points**:
- Tab must respect empty states — "No chats to export", "No characters yet", "No completed sessions"
- Download buttons must be `download` attributes on `<a>` tags with `blob:` URLs, not `window.open()`
- Tab must work in Tauri (native file save dialog via `@tauri-apps/plugin-dialog` — fall back to browser download if Tauri API unavailable)

### AC-7: Character Card Import — PNG Metadata
**Given** an `.aikami.png` file exported from Aikami (or a PNG with a `tEXt` chunk keyword `aikami_character`)
**When** the user drags the PNG onto the character import dropzone (existing `character_importer.ts`)
**Then** the importer: (a) detects the `tEXt` chunk with keyword `aikami_character`, (b) parses the embedded JSON, (c) validates against `BaseCharacterSheetSchema`, (d) pre-fills the character creation form. The avatar is extracted from the PNG image data itself.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test — `character_importer.test.ts` extended with PNG chunk extraction test
- E2E / Visual:
    - **Functional**: `tests/client/import-character-png.spec.ts` — drag PNG card, verify form pre-fill
    - **Visual**: N/A

**Watch Points**:
- Non-Aikami PNGs (no `aikami_character` chunk) must fall through to the existing import flow without error
- Corrupted `tEXt` chunks (invalid JSON) must show "This card appears to be damaged" error, not crash
- Multiple `tEXt` chunks with keyword `aikami_character` — use the last one (PNG spec allows duplicates)

## Implementation Sequence

1. **Phase 1 (Formatters)**: Build `jsonl_formatter.ts`, `plaintext_formatter.ts`, `epub_formatter.ts` in `apps/frontend/client/src/lib/services/export/formatters/`. Pure functions, fully unit tested. Add `jszip` dependency for EPUB and backup zip.
2. **Phase 2 (Service)**: Build `exportService` singleton — orchestrates repository reads, format selection, Blob generation, download triggering. Wire into existing `chatService`, character repositories, and session data (C-240).
3. **Phase 3 (Character Card)**: Extend `character_importer.ts` with PNG `tEXt` chunk reader + writer. Add `AikamiCharacterCard` type to `packages/shared/types/`. Build JSON card export.
4. **Phase 4 (UI)**: Build "Export & Data" settings tab with all sections. Add download triggers. Handle Tauri vs browser download paths. Add empty states.
5. **Phase 5 (Validation)**: Run `validate()` with test=true. Run functional E2E tests covering all export formats, character card round-trip, backup zip, and settings UI. Run visual test for settings tab.

## Edge Cases & Gotchas

- **Large chat export (10K+ messages)**: JSONL generation must stream line-by-line (don't build the full string in memory). Use a generator pattern that yields lines, consumed by the Blob constructor.
- **EPUB `.opf` UUID**: Generate a UUIDv4 for the `<dc:identifier>` — must be stable per session (derive from session ID, not random each export).
- **PNG chunk CRC**: `tEXt` chunks require a CRC-32 checksum after the data. The writer must compute and append it correctly, or the PNG is invalid. Use a library or port a CRC-32 implementation.
- **Character JSON with circular references**: TypeBox schemas are flat, but ensure `JSON.stringify` doesn't encounter circular refs. If metadata on character references chat IDs, omit them in export.
- **File name collision**: If user exports the same chat twice in one second, append `(1)`, `(2)` to avoid overwriting. Use a counter or the timestamp with millisecond precision.
- **Tauri file dialog fallback**: In Tauri context, use `@tauri-apps/plugin-dialog` `save()` to let the user pick a save location. In browser, use `<a download>` with `blob:` URL. Detect Tauri via `window.__TAURI_INTERNALS__`.
- **EPUB XHTML validity**: All XHTML files must have `xmlns="http://www.w3.org/1999/xhtml"` on the `<html>` element. Self-closing tags like `<br/>` must have the trailing slash. Use a minimal template literal, not raw string concatenation.
- **Backup with Firestore timestamps**: Firestore `Timestamp` objects must be serialized as ISO 8601 strings in JSON exports. The `FieldValueSchema` from `@aikami/schemas` should guide type discrimination.
