## 1. Schema Updates

- [x] 1.1 Update MessageSchema with new fields (editedAt, editedBy, regeneratedFrom, attachments, metadata)
- [x] 1.2 Update ChatSchema with RPG fields (affection, stats, backgroundImageUrl)
- [x] 1.3 Add migration strategy for existing data
- [x] 1.4 Run typecheck and validate schemas

## 2. Database Services

- [x] 2.1 Create message repository (CRUD operations)
- [x] 2.2 Add message update method to chat repository
- [x] 2.3 Add getOrCreateChat method to npcChatService
- [x] 2.4 Add deleteMessage method
- [x] 2.5 Add updateMessage method

## 3. Mock Services (Emulator Mode)

- [x] 3.1 Create imageGenerationService with emulator mock
- [x] 3.2 Create ttsService with emulator mock
- [x] 3.3 Follow existing sendMessage pattern for consistency
- [x] 3.4 Add demo mode indicators

## 4. Chat View Model Enhancement

- [x] 4.1 Add editMessage method
- [x] 4.2 Add deleteMessage method  
- [x] 4.3 Add regenerateMessage method
- [x] 4.4 Add generateImage method
- [x] 4.5 Add playTts method
- [x] 4.6 Add attachFile method
- [x] 4.7 Add affection tracking
- [x] 4.8 Add dice roll methods (perception, persuasion)
- [x] 4.9 Add background image generation

## 5. SSR Enhancement

- [x] 5.1 Update chat page server load to fetch both chat and NPC
- [x] 5.2 Pass chat data to page component
- [x] 5.3 Handle auth verification in SSR
- [x] 5.4 Handle 404/403 errors properly
- [x] 5.5 Support npcId query param

## 6. NPC List Integration

- [x] 6.1 Add getOrCreateChat to npcListViewModel
- [x] 6.2 Update navigateToChat to create chat if needed
- [x] 6.3 Add chat indicators to NPC list items
- [x] 6.4 Add "Chats" tab/section to NPC list
- [x] 6.5 Add delete chat functionality

## 7. UI Components

- [x] 7.1 Create MessageBubble component with edit/delete/regenerate buttons
- [x] 7.2 Create MessageInput with attachment support
- [x] 7.3 Create StatsPanel component (collapsible)
- [x] 7.4 Create AffectionMeter component
- [x] 7.5 Create DiceRollPanel component
- [x] 7.6 Create ImageGenerator component
- [x] 7.7 Create TTSPlayer component
- [x] 7.8 Create ChatBackground component

## 8. Chat Page Updates

- [x] 8.1 Integrate SSR data into chat view
- [x] 8.2 Add RPG panel to chat layout
- [x] 8.3 Add action toolbar (dice, image, TTS)
- [x] 8.4 Update ChatContainer for new message features
- [x] 8.5 Add loading/typing indicators

## 9. Testing

- [x] 9.1 Test message CRUD operations
- [x] 9.2 Test edit/delete/regenerate flows
- [x] 9.3 Test image generation in emulator
- [x] 9.4 Test TTS in emulator
- [x] 9.5 Test NPC list → chat flow
- [x] 9.6 Test SSR with auth
- [x] 9.7 Test dice roll calculations
- [x] 9.8 Run full test suite

## 10. Polish & Validation

- [x] 10.1 Run lint and format
- [x] 10.2 Run typecheck
- [x] 10.3 Verify emulator mode works correctly
- [x] 10.4 Check responsive design
- [x] 10.5 Verify accessibility
