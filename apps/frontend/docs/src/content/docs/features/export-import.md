---
title: Export & Import
description: Export your chats, characters, and sessions in multiple formats. Import Aikami character cards.
---

The **Export & Data** system lets you back up, share, and relive your adventures. Export individual chats as JSONL or plain text, download completed sessions as EPUB novels, save characters as portable `.aikami.json` or `.aikami.png` cards, or create a full backup zip of everything.

> 🔒 **Local-first**: Your chats, characters, and personas live on your device in a local database. Everything works fully offline — export is the way to move your data between devices or keep a backup.

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

### Supported Formats

Aikami imports character cards from multiple sources:

| Format | Source | File Extension |
|--------|--------|----------------|
| **Aikami JSON** | Native Aikami character export | `.aikami.json` |
| **Aikami PNG** | Native Aikami character card | `.aikami.png` |
| **SillyTavern V2** | SillyTavern / Marinara-Engine | `.png` (chara chunk) |
| **SillyTavern V3** | SillyTavern / Marinara-Engine | `.png` (ccv3 chunk) |
| **SillyTavern JSON** | Raw V2/V3 card export | `.json` |
| **RisuAI** | RisuAI character cards | `.png` (cbar chunk) |

### Imported Fields

When importing a SillyTavern V2 or V3 character card, the following fields are recognised:

| Card Field | Aikami Mapping |
|------------|----------------|
| `name` | Persona name |
| `description` | Background |
| `personality` | Personality traits |
| `scenario` | Notes |
| `first_mes` | First message (NPC compilation) |
| `system_prompt` | System prompt (NPC compilation) |
| `extensions.abilityScores` | D&D ability scores |
| `data.assets` (V3) | Card assets (preserved in extensions) |
| `character_book` | **Lorebook** — entries are imported into the lorebook system and available for keyword scanning and GM prompt injection |

### Lorebook Import (C-439)

If the imported card contains an embedded `character_book` (lorebook), its entries are automatically imported into Aikami's lorebook system:

- **Keywords** (`keys`) become lorebook keywords for trigger matching.
- **Content** (`content`) becomes the lore entry text.
- **Constant entries** (`constant: true`) are always included regardless of keyword match.
- **Disabled entries** (`enabled: false`) are skipped and counted in the import summary.
- **Unmapped fields** (`case_sensitive`, `secondary_keys`, `position`, etc.) are preserved in the entry's extensions bag.
- **Entry limit**: a maximum of 200 entries are imported; entries beyond this are skipped with a summary message.
- **Content limit**: individual entries over 10,000 characters are skipped.

After import, a summary banner shows how many entries were imported and how many were skipped, with reasons.

### Usage

On the **My Personas** screen, click the **Import Card** button and select a `.png` or `.json` file using the file picker. The importer detects the format automatically.

Source: `apps/frontend/client/src/lib/services/character/` and `apps/frontend/client/src/lib/views/character/persona/list/`.
