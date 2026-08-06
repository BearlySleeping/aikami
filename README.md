# Aikami — AI-Powered RPG Platform

**Build, Play, and Share Immersive 2D JRPG Adventures**

Aikami is an **AI-driven platform** for creating and experiencing rich, interactive 2D JRPG games. Powered by **SvelteKit, PixiJS v8, bitECS, and Turso**, Aikami combines cutting-edge technology with a passion for storytelling and gameplay.

---

## 🌟 What is Aikami?

Aikami is a **next-generation RPG platform** that empowers creators to design and players to explore **AI-enhanced 2D JRPG worlds**. Whether you're a developer, storyteller, or gamer, Aikami provides the tools to bring your vision to life—with **smart AI integration, modular architecture, and a focus on immersive experiences**.

## ✨ Key Features

- **Offline-First**: Campaigns, saves, and chat history live in a local **Turso (libSQL)** database (C-321) — play with zero network; cloud sync is optional, never a boot dependency
- **Game First**: Launch into a spatial **PixiJS v8 + bitECS** world, not a chat dashboard; deterministic rules decide, AI narrates
- **AI-Powered NPCs**: Text, image, and voice generation through one `AiProviderGateway` — local (Ollama / ComfyUI / Kokoro via Docker), BYOK, or Aikami-hosted
- **Community Hub**: A SvelteKit **SSR hub on Google Cloud Run (Bun)** for community assets, maps, mods, and managing your own characters/personas
- **Cross-Platform**: PWA, desktop export (Tauri v2), and web hub
- **Vendor-Agnostic AI**: Bring your own cloud key or run local models — your world data stays on your machine

---

## 🚀 Vision

Our vision is to **democratize game creation** and **redefine interactive storytelling**. By leveraging AI, Aikami enables:

- **Dynamic Worlds**: AI-generated content that adapts to player choices.
- **Seamless Collaboration**: Tools for teams to build together, faster.
- **Accessibility**: A platform for both indie developers and AAA studios.

---

## 🔗 Quick Links

| Resource                  | Link                                                                        |
| ------------------------- | --------------------------------------------------------------------------- |
| **Landing Page**          | [bearlysleeping.com](https://bearlysleeping.com)                            |
| **Client**                | [aikami.bearlysleeping.com](https://aikami.bearlysleeping.com)              |
| **Discord Community**     | [Join our Discord](https://discord.gg/XuuhWvSxHH)                           |
| **Issues & Feedback**     | [GitHub Issues](https://github.com/BearlySleeping/aikami/issues)            |
| **Latest Release**        | [GitHub Releases](https://github.com/BearlySleeping/aikami/releases/latest) |

---

## 🛠️ Getting Started

New to Aikami? Here's how to dive in:

1. **Explore the Platform**: Visit [aikami.bearlysleeping.com](https://aikami.bearlysleeping.com) to experience Aikami firsthand.
2. **Join the Community**: Connect with other creators and players on [Discord](https://discord.gg/XuuhWvSxHH).
3. **Contribute**: Help shape the future of Aikami by reporting issues or suggesting features on [GitHub](https://github.com/BearlySleeping/aikami/issues).

---

## 📜 Documentation

For technical details, architecture, and development guides, check out the [**docs/**](./docs) directory.

Key resources to get you started:

- [**Setup Guide**](docs/intro/setup.md) — Prerequisites, first-time setup, and environment configuration
- [**Developer Workflow**](docs/guides/dev-workflow.md) — Daily commands, testing, and emulator usage
- [**Architecture**](docs/architecture/architecture.md) — System architecture and the game engine boundary
- [**Project Structure**](docs/guides/STRUCTURE.md) — Monorepo layout and where things live
- [**Tech Stack**](docs/guides/STACK.md) — Technologies, frameworks, and services
- [**Coding Standards**](docs/guides/CODING_STANDARDS.md) — Conventions for contributing code

---

**BearlySleeping** — *Dreaming big, one line of code at a time.*
