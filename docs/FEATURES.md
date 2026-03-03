# Aikami Feature Specification

This document outlines the specifications for implementing 10 advanced features inspired by SillyTavern and RisuAI.

---

## 1. User Personas

**Description**: User's own character cards that define their identity in conversations. Swappable with their own avatar, description, and lore.

**Data Model**:
```typescript
type PersonaData = {
  id: string;
  uid: string; // owner
  name: string;
  description: string; // How the AI should characterize the user
  avatarUrl?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  tags: string[];
  isActive: boolean; // Only one active persona at a time
  createdAt: Date;
  updatedAt: Date;
};
```

**Features**:
- Create/edit/delete personas
- Switch between personas
- Persona-specific chat history
- Import/export persona as JSON

---

## 2. Group Chats

**Description**: Multiple AI characters chat with each other and the user in group conversations.

**Data Model**:
```typescript
type GroupChatData = {
  id: string;
  uid: string; // owner
  name: string;
  characterIds: string[]; // NPCs in the group
  personaId?: string; // User's persona in this group
  createdAt: Date;
  updatedAt: Date;
};

type GroupMessageData = {
  id: string;
  groupChatId: string;
  characterId: string; // Which character sent this
  sender: 'user' | 'character';
  text: string;
  timestamp: Date;
};
```

**Features**:
- Create group chats with multiple NPCs
- Characters respond to each other
- Group-specific greetings
- Configure reply order (sequential, random, etc.)

---

## 3. Character Relationships

**Description**: Dynamic relationship tracking between user and characters that evolves through dialogue.

**Data Model**:
```typescript
type RelationshipType = 'ally' | 'enemy' | 'friend' | 'romantic' | 'neutral' | 'rival';

type CharacterRelationshipData = {
  id: string;
  uid: string;
  characterId: string;
  relationshipType: RelationshipType;
  trust: number; // -100 to 100
  affinity: number; // -100 to 100
  history: RelationshipEvent[]; // Key events that shaped the relationship
  notes: string; // AI-generated relationship summary
  updatedAt: Date;
};

type RelationshipEvent = {
  type: 'positive' | 'negative' | 'neutral';
  description: string;
  timestamp: Date;
};
```

**Features**:
- Track trust/affinity scores
- Relationship evolves based on conversation
- AI considers relationship in responses
- Visual relationship indicator

---

## 4. Chat Summarization

**Description**: Automatic summarization of chat history to manage long conversations.

**Data Model**:
```typescript
type ChatSummaryData = {
  id: string;
  chatId: string;
  summary: string;
  keyEvents: string[]; // Bullet points of important events
  mentionedCharacters: string[]; // NPCs mentioned
  mentionedLocations: string[]; // Locations mentioned
  tokenCount: number;
  createdAt: Date;
};
```

**Features**:
- Auto-summarize after X messages or X tokens
- Manual summary trigger
- Summaries inserted into context
- View/edit summaries

---

## 5. AI Lorebook Generator

**Description**: AI automatically generates lorebook entries from conversation context.

**Data Model**:
```typescript
type LorebookEntryData = {
  id: string;
  uid: string;
  worldId?: string; // Optional world binding
  characterId?: string; // Optional character binding
  key: string; // Primary keywords (comma-separated)
  content: string; // The lore content
  secondaryKeys: string[]; // Additional trigger keywords
  insertionOrder: number; // Priority
  randomChance: number; // 0-100, chance to activate
  useProbability: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type LorebookData = {
  id: string;
  uid: string;
  name: string;
  description?: string;
  entries: LorebookEntryData[];
  createdAt: Date;
  updatedAt: Date;
};
```

**Features**:
- AI suggests new entries based on chat
- Auto-activate based on keywords
- Bind lorebooks to characters/worlds
- Import/export lorebooks

---

## 6. Persistent World State

**Description**: AI maintains persistent world state that evolves with the story.

**Data Model**:
```typescript
type WorldLocationData = {
  id: string;
  worldId: string;
  name: string;
  description: string;
  connections: string[]; // IDs of connected locations
 NPCs: string[]; // NPCs at this location
  lastVisited?: Date;
};

type WorldEventData = {
  id: string;
  worldId: string;
  title: string;
  description: string;
  participants: string[]; // Character IDs
  locationId?: string;
  timestamp: Date; // In-world time
  isMajor: boolean;
};

type WorldStateData = {
  id: string;
  uid: string;
  name: string;
  description: string;
  locations: WorldLocationData[];
  events: WorldEventData[];
  variables: Record<string, string>; // Custom world variables
  createdAt: Date;
  updatedAt: Date;
};
```

**Features**:
- Create/edit world locations
- Track world events
- AI updates world state
- Location-based context

---

## 7. Cross-Chat Memory

**Description**: Characters remember interactions across different chats.

**Data Model**:
```typescript
type CharacterMemoryData = {
  id: string;
  characterId: string;
  uid: string;
  memories: MemoryEntry[];
  lastConsolidated?: Date;
};

type MemoryEntry = {
  id: string;
  chatId: string;
  summary: string; // AI-generated summary of the interaction
  importance: number; // 0-100
  entities: string[]; // Characters, locations mentioned
  emotionalTone: 'positive' | 'negative' | 'neutral';
  createdAt: Date;
};

type MemoryConsolidationData = {
  id: string;
  characterId: string;
  consolidatedSummary: string;
  mergedFrom: string[]; // MemoryEntry IDs that were merged
  createdAt: Date;
};
```

**Features**:
- Automatic memory capture
- Memory consolidation/merging
- Import memories into context
- Memory decay (forgotten after X time)

---

## 8. Branching Stories

**Description**: Create and manage different story branches/alternate timelines.

**Data Model**:
```typescript
type StoryBranchData = {
  id: string;
  uid: string;
  name: string;
  description: string;
  parentBranchId?: string; // For nested branches
  chatId: string; // The chat this branch is for
  divergedAtMessageId: string; // Where this branch split
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type BranchPointData = {
  id: string;
  chatId: string;
  messageId: string;
  choice: string; // The user's choice that led here
  alternativeChoices: string[]; // Other possible choices
  branchId: string;
};
```

**Features**:
- Create branch at any message
- View branch tree
- Switch between branches
- Merge branches

---

## 9. Knowledge Graph

**Description**: Visual knowledge graph showing character connections and world lore.

**Data Model**:
```typescript
type KGNodeType = 'character' | 'location' | 'event' | 'item' | 'concept';

type KGNodeData = {
  id: string;
  type: KGNodeType;
  name: string;
  description: string;
  properties: Record<string, string>;
  worldId?: string;
  characterId?: string;
};

type KGEdgeData = {
  id: string;
  sourceId: string; // Node ID
  targetId: string; // Node ID
  relationship: string; // e.g., "lives_in", "knows", "owns"
  weight: number; // Connection strength 0-100
};

type KnowledgeGraphData = {
  id: string;
  uid: string;
  name: string;
  nodes: KGNodeData[];
  edges: KGEdgeData[];
  createdAt: Date;
  updatedAt: Date;
};
```

**Features**:
- Visual graph display
- AI auto-generates nodes/edges
- Interactive exploration
- Link to characters/worlds

---

## 10. Voice Cloning (TTS)

**Description**: Text-to-speech with character-specific voices.

**Data Model**:
```typescript
type TTSProvider = 'elevenlabs' | 'silero' | 'coqui' | 'edge';

type VoiceConfigData = {
  id: string;
  characterId?: string; // Character-specific
  personaId?: string; // Or persona-specific
  provider: TTSProvider;
  voiceId?: string; // Provider-specific voice ID
  settings: {
    speed: number; // 0.5 - 2.0
    pitch: number; // 0.5 - 2.0
    volume: number; // 0 - 1
  };
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type GeneratedSpeechData = {
  id: string;
  chatId: string;
  messageId: string;
  audioUrl: string;
  provider: TTSProvider;
  duration: number; // seconds
  createdAt: Date;
};
```

**Features**:
- Character-specific voices
- Multiple TTS providers
- Voice settings (speed, pitch)
- Auto-play responses

---

## Implementation Priority

1. **Phase 1 - Foundation**: User Personas, Group Chats
2. **Phase 2 - Core Features**: Character Relationships, Chat Summarization, AI Lorebook
3. **Phase 3 - Advanced**: Persistent World State, Cross-Chat Memory
4. **Phase 4 - Premium**: Branching Stories, Knowledge Graph, Voice Cloning
