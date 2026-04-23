# AI Research Findings - April 2026

This document summarizes the findings from AI tool and technology research conducted in April 2026, including recommendations for optimizing the Aikami tech stack.

## Table of Contents

1. [Database Options](#database-options)
2. [AI API Providers](#ai-api-providers)
3. [GodotJS Ecosystem](#godotjs-ecosystem)
4. [Open-Source References](#open-source-references)
5. [Cost Projections](#cost-projections)
6. [Recommendations](#recommendations)
7. [Next Steps](#next-steps)

---

## Database Options

### Current State

Aikami uses **Firebase Firestore (NoSQL)**, which presents challenges for relational RPG data (inventory ↔ items ↔ stats).

### Options Evaluated

| Provider | Type | Free Tier | Pros | Cons |
|----------|------|-----------|------|------|
| **Firebase Firestore** | NoSQL | 5GB storage, 50K reads/day | Native offline, familiar | Expensive at scale, denormalization pain |
| **Firebase Data Connect** | PostgreSQL | 10GB, 250K free ops | SQL support, same ecosystem | Requires migration, ~$4/M ops after free |
| **Supabase** | PostgreSQL | 500MB DB, 1GB storage | Deep SQL, RLS policies | Pauses after 1 week inactive |
| **PocketBase** | SQLite | Unlimited (self-hosted) | Single binary, cheap VPS hosting | Single-server scaling |
| **Convex** | ACID Doc | 0.5GB, 1M function calls | Native SvelteKit reactivity, funded $24M | Function call limits |
| **Appwrite** | MariaDB | 2GB storage | Self-hosted, Docker | 2 projects max free |

### Firebase Data Connect (NEW)

As of 2026, Firebase offers **Data Connect** - a fully managed PostgreSQL service powered by Cloud SQL:

- Complex SQL joins for RPG data (items ↔ stats ↔ quests)
- Vector search for AI agents
- Type-safe SDKs generated from schema
- 90-day free trial on Spark plan

**Migration Complexity**: Medium - requires porting NoSQL documents to structured schema.

---

## AI API Providers

### Current State

Aikami uses **Google AI via Genkit**, which is functional but may not be the most cost-effective.

### Provider Comparison (April 2026)

| Provider | Hardware | Free Tier Highlights | Paid Pricing | Best For |
|----------|----------|----------------------|--------------|----------|
| **Groq** | LPU | 30 RPM, 14.4K requests/day | ~$0.10/1M tokens | Real-time NPC chat (500 tok/sec) |
| **Cerebras** | Wafer-Scale | 1M tokens/day free | $10 dev tier | Bulk procedural generation |
| **OpenRouter** | Aggregator | 29+ free models | Variable (often cheap) | Async lore, background tasks |
| **Together AI** | GPU | $5-$25 trial credits | DeepSeek V3: $0.20/1M | Model variety |
| **Gemini Flash-Lite** | TPU | Generous free tier | $0.075/1M tokens | Cost efficiency |

### Recommended AI Strategy

| Use Case | Provider | Reasoning |
|----------|----------|-----------|
| **Real-time NPC dialogue** | Groq | Fastest inference (500 tok/sec) |
| **Procedural generation** | Cerebras | High volume free tier |
| **Async lore/items** | OpenRouter free tier | No cost, good for background |
| **Fallback/resilience** | Gemini Flash-Lite | Reliable, cheap |

**Genkit** can handle intelligent routing with automatic fallbacks when rate limits are hit.

---

## GodotJS Ecosystem

### Current State

Aikami uses **@godot-js/godot-ts** for TypeScript bindings in Godot.

### Status Update

| Item | Status |
|------|--------|
| **@godot-js/godot-ts** | Actively maintained (v1.0.0 - Feb 2025) |
| V8 engine support | ✅ Stable |
| Hot-reloading | ✅ Working |
| Worker threads | ⚠️ Experimental |

### Alternatives

If GodotJS is abandoned:

1. **C# (.NET)** - Primary production-ready alternative
2. **GDExtension** - C++/Rust native extensions for intensive logic
3. **GDScript** - Native but lacks TypeScript benefits

**Recommendation**: GodotJS is safe to use for now.

---

## Open-Source References

### AI-Powered RPG Projects (Same Stack)

| Repository | Stack | Relevance |
|------------|-------|-----------|
| `infinite-tales-rpg` | SvelteKit 2 + Svelte 5 + Gemini | **Exact match** - AI choose-your-own-adventure with RPG stats |
| `Narraitor` | Svelte 5 | Dynamic narrative adapting to world rules |
| `rpg-companion-sillytavern` | Web | Stat/inventory parsing from LLM output |
| `GameMasterAI` | Web | TTRPG + LLM as automated DM |
| `singularity` | X-Talk | Stateful game sessions, multi-bot interactions |

### Key Architectural Lessons

From SillyTavern and related projects:

1. **Separate concerns**: Game logic (stats, inventory) handled by client; AI handles narrative only
2. **Structured data parsing**: Use regex/JSON to extract commands from LLM output
3. **Context injection**: Client sends factual data → LLM generates narrative → Client updates state

---

## Cost Projections

### Scenario: 10,000 Concurrent Players

| Provider | Monthly Estimate |
|----------|------------------|
| **PocketBase** (VPS) | $4-$5 (Hetzner) |
| **Supabase** (Pro) | $25 + egress overages |
| **Firebase Firestore** | $400-$800+ (per-operation pricing) |
| **Convex** | Varies by usage |

### AI Costs at Scale

| Provider | 10K players scenario |
|----------|---------------------|
| Free tiers only | **Bottleneck immediately** |
| Groq/Cerebras paid | ~$0.10/1M tokens |
| Gemini Flash-Lite | ~$0.075/1M tokens (cheapest) |

**Reality Check**: At 10K concurrent players, you need paid AI tiers regardless of provider.

---

## Recommendations

### Database

| Decision | Recommendation | Rationale |
|----------|----------------|-----------|
| **Short-term** | Keep Firestore NoSQL | Migration cost isn't justified yet |
| **Long-term** | Evaluate Firebase Data Connect | Same ecosystem, SQL benefits |
| **Alternative** | PocketBase if leaving Firebase | Cheapest at scale |

### AI API

| Decision | Recommendation | Rationale |
|----------|----------------|-----------|
| **Primary** | Groq (real-time) + OpenRouter free (async) | Fastest + free tier |
| **Framework** | Keep Genkit | Handles routing/fallbacks automatically |
| **Backup** | Gemini Flash-Lite | Reliability, cost efficiency |

### GodotJS

| Decision | Recommendation |
|----------|----------------|
| **Keep** | @godot-js/godot-ts v1.0.0 |
| **Monitor** | Community activity for alternatives |

---

## Next Steps

### Phase 1: Quick Wins (This Week)

- [ ] Add OpenRouter as a free-tier AI provider in Genkit config
- [ ] Configure Groq as primary real-time provider with fallback to OpenRouter
- [ ] Review `infinite-tales-rpg` repo for architecture patterns

### Phase 2: Evaluation (This Month)

- [ ] Prototype: PocketBase vs Firestore for game state
- [ ] Evaluate Firebase Data Connect if SQL is needed
- [ ] Test GodotJS v1.0.0 with current Godot 4.6

### Phase 3: Long-term (Next Quarter)

- [ ] Cost analysis with realistic player projections
- [ ] Consider PocketBase migration if Firebase costs become prohibitive
- [ ] Fork/reference `Narraitor` for narrative system

---

## Appendix: Key Resources

- [Firebase Data Connect](https://firebase.google.com/docs/data-connect)
- [Groq API](https://console.groq.com/)
- [OpenRouter Free Models](https://openrouter.ai/models?free=true)
- [Cerebras Inference](https://cerebras.ai/)
- [infinite-tales-rpg](https://github.com/JayJayBinks/infinite-tales-rpg)
- [Narraitor](https://github.com/jerseycheese/Narraitor)
- [PocketBase](https://pocketbase.io/)
