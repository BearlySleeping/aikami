## Context

The Aikami project is a DND/JRPG companion app with NPCs that users can chat with. Currently, the chat system is basic with limited functionality:
- Messages stored in Firestore but schema is minimal
- No message editing, deletion, or regeneration
- No rich media (images, TTS, file embeds)
- No RPG mechanics integration (stats, affection, dice checks)
- NPC list doesn't create/manage chat sessions
- SSR needs improvement for chat page

This design addresses a complete chat system overhaul inspired by RisuAI and SillyTavern patterns, adapted for Aikami's DND/JRPG theme.

## Goals / Non-Goals

**Goals:**
- Full CRUD for messages (create, read, update, delete)
- Message regeneration (regenerate AI response)
- Image generation (mocked in emulator)
- TTS narration (mocked in emulator)
- File/image embedding in messages
- RPG mechanics: stats display, affection system, perception/persuasion checks
- Seamless NPC list → chat flow
- Proper SSR with chat + NPC data passing

**Non-Goals:**
- Real image generation (mock only, even in production)
- Real TTS (mock only)
- Group chat / multi-NPC chat
- Voice input
- End-to-end encryption

## Decisions

### 1. Chat Storage: Separate Message Collection vs Embedded Messages

**Decision:** Use separate message collection with chat reference

**Rationale:** 
- Better scalability for long conversations
- Easier to query/edit individual messages
- Firestore subcollections pattern aligns with existing architecture

**Alternatives Considered:**
- Embedded messages in chat document (rejected: document size limits, harder to query)

### 2. Message Schema: Add Action Fields

**Decision:** Extend MessageSchema with:
- `editedAt`: timestamp for edit tracking
- `editedBy`: 'user' | 'ai' 
- `regeneratedFrom`: messageId reference
- `attachments`: array of { type, url, name }
- `metadata`: { imagePrompt?, ttsVoice?, diceRolls? }

**Rationale:** Enables edit/delete/regenerate without schema migration

### 3. Image Generation: Mock Service Pattern

**Decision:** Create `imageGenerationService` with emulator mock following existing `sendMessage` pattern

**Rationale:**
- Consistent with emulator mode architecture
- Easy to swap mock for real implementation later

### 4. TTS: Mock Service Pattern

**Decision:** Create `ttsService` with emulator mock returning mock audio URL

**Rationale:** Same as image generation - consistent emulator pattern

### 5. RPG Data: Chat-Affine Storage

**Decision:** Store RPG data (affection, stats) in Chat document, not NPC

**Rationale:**
- Each user has their own relationship with NPC
- Persists across chat sessions
- Separates NPC definition from user progression

### 6. NPC List → Chat Flow

**Decision:** 
- On NPC click: check for existing chat → if exists, navigate to chat/{chatId}?npcId={npcId}
- If no chat: create new chat → navigate to chat/{chatId}?npcId={npcId}
- SSR loads both chat and NPC data

**Rationale:**
- Clean URL structure with npcId for NPC-specific features
- Chat ID in URL for direct linking
- SSR provides initial data, view model hydrates

## Risks / Trade-offs

- **[Risk]** Long chat history impacts performance → **Mitigation**: Implement pagination, lazy loading
- **[Risk]** Image/TTS mocks may be confusing → **Mitigation**: Clear UI indicators showing "Demo Mode"
- **[Risk]** Schema changes require migration → **Mitigation**: Use optional fields, backward compatible
- **[Risk]** SSR complexity with auth → **Mitigation**: Graceful fallback to client-side load

## Migration Plan

1. Update schemas (backward compatible)
2. Create mock services (image, TTS)
3. Create/update SSR for chat route
4. Update NPC list view model with chat creation
5. Enhance chat view model with new features
6. Update UI components

## Open Questions

- Should affection affect AI responses? (future feature)
- Real image generation provider? (Stable Diffusion, DALL-E)
- Voice input integration?
