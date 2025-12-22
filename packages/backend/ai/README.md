# AI Backend for Dungeons & Dragons RPG

This package contains examples and implementations of AI features powered by Google's Gemini models, tailored for a Dungeons & Dragons-style RPG. The examples here (`tool-calling.ts`, `schema-input.ts`) serve as a foundation for building a dynamic and interactive game world.

## Key Gemini Features & Use Cases

Below are some powerful features from the Gemini API and ideas for how they can be leveraged to create an intelligent Dungeon Master (DM) and a responsive game environment.

### 1. Tool Calling

Tool calling allows the AI to use external functions (tools) that you define. This makes the AI an active participant in the game, capable of affecting the game state or retrieving specific information.

**Concept:** Instead of just generating text, the AI can decide to call a function like `rollDice()` or `getCharacterStats()` and then use the result of that function to inform its next response.

**D&D Use Case Examples:**

- **`rollDice(notation: "1d20+5")`**: The AI can roll any dice combination needed for skill checks, attack rolls, or saving throws.
  - _Player: "I attack the goblin with my sword."_
  - _AI DM: (Calls `rollDice("1d20+5")` -> gets 18) "You swing your sword and hit the goblin for 8 damage!"_

- **`getCharacterStats(character: "PlayerName", stat: "strength")`**: The AI can look up character sheet information to make informed decisions.
  - _Player: "I try to break down the door."_
  - _AI DM: (Calls `getCharacterStats("Aragorn", "strength")` -> gets 18) "With your mighty strength, you easily smash the door to splinters."_

- **`triggerGameEvent(event: "trap", details: "A pitfall opens...")`**: The AI can act as a true DM by triggering scripted or dynamic events in the game world.
  - _Player: "I walk down the dark hallway."_
  - _AI DM: (Calls `triggerGameEvent("trap", ...)` ) "As you step on a loose stone, you hear a click, and the floor gives way beneath you!"_

### 2. Structured Output (Schema-Based Generation)

You can force the AI to generate responses that conform to a specific JSON schema. This is incredibly powerful for generating consistent and predictable game content that your application can easily parse and use.

**Concept:** You define a `zod` schema for the data you want, and the AI will generate a JSON object matching that schema.

**D&D Use Case Examples:**

- **NPC Generation**: Create a schema for a non-player character and ask the AI to generate one on the fly.
  - _Prompt: "Create a mysterious tavern keeper."_
  - _AI Output (JSON):_
    ```json
    {
      "name": "Elara Willowshade",
      "race": "Half-Elf",
      "personality": ["wary", "observant", "secretive"],
      "secret": "She is a retired adventurer hiding from her old crew.",
      "questHook": "She needs someone to retrieve a lost locket from a nearby ruin."
    }
    ```

- **Quest Generation**: Define a schema for quests to ensure they always have the necessary components.
  - _Prompt: "Generate a beginner quest for a new party."_
  - _AI Output (JSON):_
    ```json
    {
      "title": "The Missing Shipment",
      "description": "A local merchant's shipment of valuable silks has been stolen by goblins.",
      "objectives": [
        "Track the goblins to their hideout",
        "Defeat the goblin leader",
        "Return the stolen silks"
      ],
      "reward": { "gold": 50, "items": ["Potion of Healing"] }
    }
    ```

- **Dynamic Area Descriptions**: When players enter a new location, the AI can generate a structured description that your game engine can use to populate the scene.
  - _Prompt: "Describe a spooky forest clearing."_
  - _AI Output (JSON):_
    ```json
    {
      "ambiance": "The air is cold and a thick fog clings to the gnarled, leafless trees.",
      "pointsOfInterest": [
        "A crumbling stone altar in the center",
        "A large, hollow tree with strange carvings",
        "A patch of glowing mushrooms"
      ],
      "npcs": ["A lone wolf watching from the shadows"],
      "loot": ["A silver dagger embedded in the altar"]
    }
    ```

By leveraging these features, you can create a truly dynamic and unpredictable D&D experience where the AI acts as a capable and creative Dungeon Master.
