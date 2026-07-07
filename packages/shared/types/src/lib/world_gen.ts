// packages/shared/types/src/lib/world_gen.ts
//
// Domain types for the World Generation Wizard (C-233).
// Defines input/output shapes for the LLM-powered world-gen pipeline,
// NPC seeding data, party arcs, HUD widget blueprints, and preset generators.
//
// Contract: C-233

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** User-provided inputs for world generation. */
export type WorldGenInput = {
  /** The story genre (e.g. "Fantasy", "Science Fiction", "Mystery", "Cyberpunk", "Horror", "Post-Apocalyptic"). */
  genre: string;
  /** The narrative tone (e.g. "Heroic", "Dark", "Lighthearted", "Noir", "Edgy", "Rebellious", "Lovecraftian", "Survival", "Hopeful", "Grim"). */
  tone: string;
  /** The world setting description. */
  setting: string;
  /** Difficulty level: "Easy", "Medium", or "Hard". */
  difficulty: string;
  /** Player goals / plot hooks. */
  goals: string;
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** A single NPC generated as part of a world. */
export type WorldGenNpc = {
  name: string;
  race: string;
  class: string;
  role: string;
  description: string;
  personality: string;
};

/** A story arc / chapter for the generated adventure. */
export type PartyArc = {
  chapter: string;
  description: string;
  objectives: string[];
  questGivers: string[];
};

/** A HUD widget blueprint for the generated world. */
export type HudWidgetBlueprint = {
  slot: string;
  label: string;
  icon: string;
  defaultVisibility: boolean;
};

/** Full output from the LLM world generation call. */
export type WorldGenOutput = {
  worldName: string;
  worldDescription: string;
  npcs: WorldGenNpc[];
  locations: string[];
  partyArcs: PartyArc[];
  hudWidgets: HudWidgetBlueprint[];
};

// ---------------------------------------------------------------------------
// Wizard state types
// ---------------------------------------------------------------------------

/** Step in the wizard state machine. */
export type WizardStep =
  | 'genre_tone'
  | 'setting_difficulty'
  | 'goals'
  | 'generating'
  | 'preview'
  | 'character_creation';

/** Aggregate result of a world generation attempt. */
export type WorldGenResult = {
  /** The generated output, if successful. */
  output: WorldGenOutput | undefined;
  /** Error message, if generation failed. */
  error: string | undefined;
  /** Whether a retry is possible. */
  canRetry: boolean;
};

// ---------------------------------------------------------------------------
// Surprise Me presets
// ---------------------------------------------------------------------------

/** A single preset entry for the Surprise Me! feature. */
export type SurpriseMePreset = {
  genre: string;
  tone: string;
  setting: string;
  difficulty: string;
  goals: string;
};

/**
 * Curated preset table for the "Surprise Me!" one-click generation mode.
 * Each entry is a coherent combination of genre, tone, setting, difficulty,
 * and goals that produces a playable adventure seed without user input.
 */
export const SURPRISE_ME_PRESETS: SurpriseMePreset[] = [
  {
    genre: 'Fantasy',
    tone: 'Heroic',
    setting:
      'The Sundered Kingdoms — a fractured land divided by ancient magical storms. Floating islands dot the sky, connected by crumbling sky-bridges. Each kingdom hoards a fragment of the Storm Crown.',
    difficulty: 'Medium',
    goals:
      'Recover the five fragments of the Storm Crown before the Void Lord uses them to tear open a permanent rift into the mortal realm. Forge alliances with at least three kingdom lords.',
  },
  {
    genre: 'Fantasy',
    tone: 'Dark',
    setting:
      'Duskhollow — a city where the sun never fully rises. Vampiric nobility rule from black-spire estates while a plague of soul-draining mist creeps up from the catacombs beneath the old temple district.',
    difficulty: 'Hard',
    goals:
      'Survive the intrigues of three warring noble houses, seal the catacomb rift, and either break the perpetual twilight or escape the city before the mist consumes it.',
  },
  {
    genre: 'Science Fiction',
    tone: 'Mysterious',
    setting:
      "The Ring of Echoes — a ancient Dyson-swarm megastructure rediscovered by a salvage expedition. Its inner surface holds intact alien ecologies, derelict starships from a thousand civilizations, and a signal that shouldn't still be broadcasting after a million years.",
    difficulty: 'Medium',
    goals:
      "Reach the Ring's core to decode the ancient signal. Choose: broadcast the warning (alerting the galaxy to a returning threat), silence it (keeping the Ring's secrets), or activate the Ring's dormant defenses.",
  },
  {
    genre: 'Science Fiction',
    tone: 'Grim',
    setting:
      'Colony CY-773 — a failed terraforming project on a tidally-locked world. The habitable twilight band holds scattered domed settlements, cannibalized machinery, and logs of a corporate experiment gone horribly wrong.',
    difficulty: 'Hard',
    goals:
      'Survive the mutated wildlife, learn what the corporation was really engineering, and decide whether to call for rescue (alerting the corporation) or find a working FTL beacon to escape independently.',
  },
  {
    genre: 'Mystery',
    tone: 'Lighthearted',
    setting:
      'The Grand Luminara Hotel — a resort station orbiting a gas giant famous for its aurora displays. A priceless artifact has gone missing during the annual Charity Gala, and everyone from the visiting ambassador to the janitorial bot is a suspect.',
    difficulty: 'Easy',
    goals:
      "Solve the theft of the Star Opal before the gala ends. Interview guests, examine clues, and piece together the culprit's identity. Bonus: recover the Opal's setting (a separate smaller crime).",
  },
  {
    genre: 'Mystery',
    tone: 'Noir',
    setting:
      'Rainport — a perpetually drizzly coastal city in an alternate 1950s. Neon signs reflect off wet asphalt. The police chief is your former partner. A missing persons case involving a brilliant inventor is connected to three recent museum heists.',
    difficulty: 'Medium',
    goals:
      'Find the inventor before the wrong people do, uncover the connection between the heists, and decide whether to expose the corrupt patron behind it all or take the payoff.',
  },
  {
    genre: 'Cyberpunk',
    tone: 'Edgy',
    setting:
      'The Sprawl-Neural Nexus — a megacity where every citizen has a mandatory neural interface. A shadowy group has discovered a backdoor in the Nexus OS that could either free everyone from corporate control — or kill everyone jacked in at the moment of activation.',
    difficulty: 'Hard',
    goals:
      'Infiltrate three corporate data fortresses to gather the components for a counter-virus. Choose: deploy the counter-virus (saving lives but preserving corporate control), or help the shadow group (freeing minds but risking mass casualties).',
  },
  {
    genre: 'Cyberpunk',
    tone: 'Rebellious',
    setting:
      'The Gutter Market — a sprawling underground bazaar beneath a sterile arcology city. Runner crews trade in black-market tech, bootleg bio-mods, and stolen data. A recent crackdown has everyone on edge, and a mysterious benefactor wants to hire your crew for one last big score.',
    difficulty: 'Easy',
    goals:
      "Pull off the heist of the decade: steal the prototype AI core from the arcology's executive floor. Uncover who the benefactor really is and why they need the core. Choose: hand it over, keep it, or sell it to the highest bidder.",
  },
  {
    genre: 'Horror',
    tone: 'Lovecraftian',
    setting:
      'The Sunken Parish of Innsmouth-over-Waves — a coastal town that appears on no map, reachable only when the fog is thick enough. The locals worship something beneath the harbor, and newcomers start hearing whispers in a language that predates human civilization.',
    difficulty: 'Hard',
    goals:
      'Discover what lies beneath the harbor, find the three seal-stones that keep the Old One sleeping, and decide whether to re-consecrate the seals (preserving the town but trapping its people) or break them (destroying the town but freeing the horror upon the world).',
  },
  {
    genre: 'Horror',
    tone: 'Survival',
    setting:
      'Arctic Station Barrow — a research outpost cut off by an unprecedented blizzard. The crew has stopped responding to radio. The isolation doors are sealed from the inside. Something is scratching at the exterior hull, and the power core is failing.',
    difficulty: 'Medium',
    goals:
      "Survive seven days until the supply drop arrives. Restore power, reinforce defenses, uncover what happened to the previous crew, and discover the source of the scratching. Escape in the supply ship — but the station's AI may have other plans.",
  },
  {
    genre: 'Post-Apocalyptic',
    tone: 'Hopeful',
    setting:
      'The Oasis Network — a chain of fertile settlements connected by dangerous trade routes across a desert that was once farmland. A century after the Collapse, the Oasis Network sends out an expedition to find the fabled Library of Alexandria, rumored to hold pre-Collapse agricultural knowledge.',
    difficulty: 'Easy',
    goals:
      'Lead the expedition across the Scarlands to find the Library. Navigate raiders, mutated creatures, and treacherous terrain. Bring back the knowledge to help the Network survive the coming drought.',
  },
  {
    genre: 'Post-Apocalyptic',
    tone: 'Grim',
    setting:
      "The Rust-Salt Wastes — a region where two failed nations' weaponized terraforming collided, leaving a toxic, crystalline wasteland. Salvagers risk their lives for pre-Collapse tech. A signal from a long-dead research bunker promises a cure for the wasting disease that's slowly killing the last human enclaves.",
    difficulty: 'Hard',
    goals:
      "Reach Bunker 7 through the Wastes. The signal is real, but the cure requires a choice: distribute it freely (risking the bunker's ancient security systems), sell it to the highest bidder (ensuring your enclave's survival), or destroy the research to prevent its weaponization.",
  },
] as const satisfies SurpriseMePreset[];

/**
 * Returns a random Surprise Me preset.
 * Deterministic for testability — pass a seed for reproducible results.
 * When seed is omitted, uses Math.random().
 */
export const getRandomPreset = (seed?: number): SurpriseMePreset => {
  const index =
    seed !== undefined
      ? Math.floor(Math.abs(seed) % SURPRISE_ME_PRESETS.length)
      : Math.floor(Math.random() * SURPRISE_ME_PRESETS.length);
  return SURPRISE_ME_PRESETS[index] as SurpriseMePreset;
};
