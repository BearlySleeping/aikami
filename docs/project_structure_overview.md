# Project Structure Overview

This document outlines the structure of our project, detailing the purpose of each directory and its contents. Our project is organized into several key directories, each serving a specific role in the development and deployment of the game and its associated tools and documentation.

## Directory Structure

```
.
├── ai
│   ├── image
│   ├── text
│   └── voice
├── docs
├── game
│   ├── audio
│   │   ├── music
│   │   └── sfx
│   ├── engine
│   │   ├── api
│   │   └── utils
│   ├── entities
│   │   ├── npc
│   │   └── player
│   ├── maps
│   │   ├── levels
│   │   └── main.tscn
│   ├── models
│   ├── tilesets
│   └── ui
│       ├── dialogue
│       └── menus
```

### AI (`/ai`)

The `ai` directory contains all artificial intelligence-related scripts and models. It is organized into subcategories for different AI functionalities:

-   **Image**: For AI that deals with image processing and generation.
-   **Text**: Contains models and scripts for text analysis, generation, and understanding.
-   **Voice**: For voice recognition and generation AI components.

These components utilize various technologies, including Hugging Face's transformers, custom Python scripts, and other machine learning tools.

### Game (`/game`)

The `game` directory houses all the Godot project files, scripts (GDScript), and assets. It is structured as follows to organize different types of game content:

-   **Audio**: Contains all audio files, including music and sound effects (SFX), organized further into `music` and `sfx`.
-   **Engine**: Scripts that form the game's engine, including APIs, managers (for dialogues, scenes, etc.), and utilities.
-   **Entities**: Game entities like NPCs and the player character, including their scripts, scenes, and assets.
-   **Maps**: Game levels and maps, including base maps and specific scenes.
-   **Models**: Data models used within the game, such as character models, item definitions, and other game logic-related structures.
-   **UI**: User interface components, including dialogue boxes, menus, and theming resources.

### Docs (`/docs`)

The `docs` directory contains all project documentation. This includes developer guides, project overviews, and any additional documentation related to project setup, deployment, and usage instructions.

### Additional Directories

-   **`.github`**: Contains GitHub-specific configurations, including workflows for CI (Continuous Integration).
-   **`lefthook.yml`**: Configuration file for Lefthook, used to manage Git hooks for actions like pre-commit checks.
-   **`LICENSE`**: The project's license file.

## Summary

This project is structured to facilitate the development of a game using the Godot engine, with a particular focus on integrating advanced AI functionalities. Each directory is tailored to separate concerns appropriately, ensuring that development within each area—be it AI, game logic, or documentation—is organized and manageable.
