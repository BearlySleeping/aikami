# AiKami - A Pixel 2D Top-Down RPG

## Introduction

AiKami aims to create a pixel 2D top-down RPG game where all NPCs and sprites are generated using AI. Inspired by D&D games like the Baldur's Gate series, AiKami seeks to create a rich and immersive world where players can explore, battle, and interact with AI-driven characters. The unique aspect of AiKami is that NPCs have their own beliefs, personalities, and strategies, and they interact with the player and the world based on these attributes.

## Project Stack

-   **[Godot Engine](https://godotengine.org/)**: The core game is developed in Godot with GDScript.
-   **[Hugging Face](https://huggingface.co/)**: For AI functionalities, including NPC and sprite generation, we leverage Hugging Face transformers library.
-   **[Bun](https://bun.sh)**: We use Bun and TypeScript to run commands to generate images outside Godot for internal use, found in the AI folder.

## Development Roadmap

See the roadmap [here](https://github.com/users/BearlySleeping/projects/1).

Overall, what's next includes:

-   **Voice Generation**: Bringing unique voices to our AI-generated NPCs.
-   **Combat System**: Refining the AI-driven combat to be dynamic and engaging.
-   **Inventory Management**: Creating an intuitive and expansive inventory system.
-   **Level System**: Developing a comprehensive level-up system that rewards player progression.
-   **Races & Classes**: Incorporating a variety of races and classes for players to choose from, each with unique abilities and lore.

## Game Concept

Imagine a D&D RPG game like Baldur's Gate or Divinity, except you cannot control any NPCs, allies, or enemies, nor can you force trades, battles, etc. NPCs must want to help you, and they will follow their own strategies that align with their beliefs, trust in you, etc. All actions are driven by AI. There will be no prewritten dialogs; all interactions will be dynamically generated with AI. However, there will still be a story and a plot since NPCs will have agendas, backgrounds, lore, goals, etc. There will be quests for players to embark on, creating a rich and evolving narrative experience.

### Examples of Gameplay Dynamics

-   **Relationship-Driven Actions**: You are in a battle with your squad. The night before, you stole from your healer. They found out and now dislike you, resulting in them being less inclined to heal you.
-   **Contextual Decision Making**: You insult a trader, and he will charge you more. Smooth talk him, and he might give you a discount.
-   **Ally Dynamics**: Any NPC can become your ally and may leave you if they no longer like you. If an NPC idolizes you, they might sacrifice themselves for your safety.

-   **Fear and Bravery**: If a person is very scared, they will stay at the back during fights. You can train them to become braver over time.

### AI-Driven Interactions

The AI makes decisions based on a list of possible actions and the context it knows. This leads to a dynamic and realistic interaction system where NPCs' behaviors are influenced by their relationships, experiences, and personal traits.

### Additional Features and Creative Examples

-   **Dynamic Quests**: Quests in AiKami are not static. An NPC might give you a quest based on their current needs or fears. For instance, a blacksmith might ask for rare materials only if his current stock is low, or a farmer might seek help with a pest problem that arises randomly.

-   **Evolving World**: The game world evolves with or without the player's direct interaction. Towns can grow or shrink based on economic conditions driven by NPCs. Natural disasters or bandit raids might change the landscape and NPC settlements.

-   **Emotional Depth**: NPCs have emotional states that influence their interactions. An NPC who has just lost a loved one might refuse to speak to you or might be driven to seek revenge, influencing the storyline dynamically.

-   **Reputation System**: Your actions influence your reputation across different regions. Save a village from a dragon, and you might be celebrated as a hero, gaining discounts and allies. Betray a trust, and you might find doors closed and prices higher in certain towns.

## Play the Demo

A demo version is available online [here](https://aikami.bearlysleeping.com).

## Contributing

Contributions are warmly welcomed! Whether you're interested in game development, AI features, or documentation, your input can help shape AiKami.

Check out our [contribution guidelines](CONTRIBUTING.md) for more information on how you can get involved.

## Feedback and Support

Your feedback is invaluable to us. For feature requests, bug reports, or support, please file an issue on our [GitHub project page](https://github.com/your-github-repo/issues).
