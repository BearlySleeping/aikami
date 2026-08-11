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
| **Offline / local** | Ollama (text), ComfyUI (image), Kokoro (voice), running as Docker services on your own hardware |
| **BYOK** | Your own key for Anthropic, OpenAI, Gemini, ElevenLabs, Stability AI, or any OpenAI-compatible endpoint |
| **Service** *(coming soon)* | Fully managed pay-as-you-go hosting — no GPU, no Docker, no setup |

## What's actually required

**A text engine is required to play.** The Game Master is the core of the game;
without a text model there's nothing refereeing your actions.

**Image and voice are optional.** The LPC sprite system covers the visual
baseline with zero AI dependency, so a text-only setup is a fully supported
configuration, not a degraded one.

## Picking a text provider

- **Local (Ollama / vLLM)** — free to run, private, works fully offline. Quality
  and speed depend entirely on the model and hardware you choose. This is the
  demanding part of a local setup; plan for a GPU.
- **BYOK cloud** — best quality per unit of effort, no hardware requirements,
  and you pay the provider directly at their rates. Aikami is never a proxy in
  that path — your key and your prompts go straight to the provider you picked.

A common arrangement is a cloud model for text (where GM quality matters most),
local ComfyUI for images (where you'd otherwise pay per generation), and local
Kokoro for voice.

## Images and voice

- **Images** — ComfyUI locally by default; DALL·E, Stability AI, NovelAI, and
  fal.ai via BYOK. See [Image Generation](/guides/image-generation/) for style
  profiles and contextual triggers.
- **Voice** — Kokoro locally by default; ElevenLabs, OpenAI TTS, VOICEVOX, and
  Fish Speech via BYOK. You can assign voices per NPC.

## Where to configure it

Everything lives under **Settings** in the client — providers, keys, endpoints,
and per-NPC overrides. Keys are stored client-side.

:::tip
Start with the hosted web client and a cloud key to see whether you like the
game at all, then move to a local setup once you know you want it. Your
campaigns export and import cleanly — see [Export & Import](/features/export-import/).
:::
