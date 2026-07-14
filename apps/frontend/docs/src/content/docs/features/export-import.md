---
title: Export & Import
description: Export your chats, characters, and sessions in multiple formats. Import Aikami character cards.
---

The **Export & Data** system lets you back up, share, and relive your adventures. Export individual chats as JSONL or plain text, download completed sessions as EPUB novels, save characters as portable `.aikami.json` or `.aikami.png` cards, or create a full backup zip of everything.

## Export Formats

| Format | What It Exports | File Extension |
|--------|----------------|----------------|
| **JSONL** | One JSON object per message with full metadata | `.jsonl` |
| **Plain Text** | Script-style prose with character names, timestamps, dice rolls | `.txt` |
| **EPUB Novel** | Session messages split into chapters with narration and dialogue | `.epub` |
| **Aikami JSON** | Full character sheet with versioning metadata | `.aikami.json` |
| **PNG Card** | Avatar image with character data embedded | `.aikami.png` |
| **Backup Zip** | All chats, characters, and personas in one archive | `.zip` |

## How to Export

Open **Settings → Export & Data** from the in-game overlay or start menu. You'll see four sections:

- **Chat Export** — a table of all your chats. Each row has JSONL and Plain Text download buttons.
- **Character Export** — your NPCs and personas. Download as JSON or PNG Card.
- **Session Export** — completed game sessions with EPUB download buttons.
- **Backup** — downloads a complete zip archive of all your data.

## Character Card Import

Drag an `.aikami.png` or `.aikami.json` file onto the character import dropzone. The importer detects embedded character data in the PNG's metadata (`aikami_character` chunk) or the JSON card format, validates it, and pre-fills the character creation form.

Source: `apps/frontend/client/src/lib/services/export/` and `apps/frontend/client/src/lib/views/settings/export/`.
