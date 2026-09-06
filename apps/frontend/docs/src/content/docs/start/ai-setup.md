---
title: Choosing your AI setup
description: Local models, bring-your-own-key, or a mix — how Aikami's provider gateway works and what each option requires.
sidebar:
  order: 2
---

All text, image, and voice generation in Aikami flows through one abstraction —
`AiProviderGateway` — so the game never cares which mode is active. That means
you can mix and match freely, and change your mind later without touching your
saves.

## The three modes

| Mode | What it means |
| --- | --- |
| **Offline / local** | llama.cpp (text), sd-server (image), sherpa-onnx/Kokoro (voice) on your own hardware — Docker is the full-stack default, with Ollama, ComfyUI, and vLLM supported as opt-in swaps |
| **BYOK** | Your own key for Anthropic, OpenAI, Gemini, ElevenLabs, Stability AI, or any OpenAI-compatible endpoint |
| **Service** *(coming soon)* | Fully managed pay-as-you-go hosting — no GPU, no Docker, no setup |

## What's actually required

**A text engine is required to play.** The Game Master is the core of the game;
without a text model there's nothing refereeing your actions.

**Image and voice are optional.** The LPC sprite system covers the visual
baseline with zero AI dependency, so a text-only setup is a fully supported
configuration, not a degraded one.

## Picking a text provider

- **Local (llama.cpp by default, or Ollama / vLLM)** — free to run, private,
  works fully offline. Quality and speed depend entirely on the model and
  hardware you choose. This is the demanding part of a local setup; a GPU
  speeds it up, but CPU works too.
- **BYOK cloud** — best quality per unit of effort, no hardware requirements,
  and you pay the provider directly at their rates. Aikami is never a proxy in
  that path — your key and your prompts go straight to the provider you picked.

A common arrangement is a cloud model for text (where GM quality matters most),
a local image engine (where you'd otherwise pay per generation), and local
voice.

## Images and voice

- **Images** — sd-server locally by default (ComfyUI is a supported opt-in
  swap for more control over workflows); DALL·E, Stability AI, NovelAI, and
  fal.ai via BYOK. See [Image Generation](/guides/image-generation/) for style
  profiles and contextual triggers, and
  [Image Engine Selection](/guides/image-engine-selection/) for the
  sd-server/ComfyUI tradeoffs.
- **Voice** — sherpa-onnx (Kokoro) locally by default; ElevenLabs, OpenAI TTS,
  VOICEVOX, and Fish Speech via BYOK. You can assign voices per NPC.

## Where to configure it

Everything lives under **Settings** → **AI** in the client. Settings are
organised by task — not by provider tree — so you find controls by what you
want to do:

| Section | What you can do |
| --- | --- |
| **AI Overview** | See all AI capabilities at a glance — status, connected model, and quick actions |
| **Story & Dialogue** | Configure the text generation model used by the Game Master and NPCs |
| **Artwork** | Set up image generation for portraits, scenes, and item art |
| **Read Aloud** | Configure text-to-speech voice for narration and dialogue |
| **Connections** | Manage provider endpoints, API keys, and accounts |
| **Advanced Routing** | Review routing information; configuration is not currently available, so use AI Overview |

Keys are stored client-side in an encrypted vault. You can search settings by
typing into the search bar at the top of the settings page.

:::tip
Start with the hosted web client and a cloud key to see whether you like the
game at all, then move to a local setup once you know you want it. Your
campaigns export and import cleanly — see [Export & Import](/features/export-import/).
:::
