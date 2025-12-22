import '../script-config.development.ts'

import type { CharacterData } from '@aikami/types'
import { characterRepository } from '@aikami/backend/database/character.ts'

const uid = 'O0O4WsmWLcaGkXBhNWpEu6O4ruz2'

const avatarUrl =
  'https://yt3.ggpht.com/C7WeyJiFARnR1Di_45SEsSQcgq1A6atU9q6XtaPP53HYYdVQ08dRvwXNciXAL2Ww2JfEOXuYNTD1Kw=s640-rw-nd-v1'

const characterCreateData: Omit<CharacterData, 'id' | 'createdAt'> = {
  name: 'Elora Swiftstrike',
  race: 'Wood Elf',
  class: 'Monk',
  level: 5,
  experiencePoints: 10000,
  abilityScores: {
    strength: 10,
    dexterity: 16,
    constitution: 14,
    intelligence: 12,
    wisdom: 15,
    charisma: 8,
  },
  hitPoints: 35,
  armorClass: 15,
  speed: 45,
  alignment: 'Lawful Good',
  background: 'Hermit',
  proficiencies: [
    'Simple Weapons',
    'Shortswords',
    'Acrobatics',
    'Stealth',
    'Insight',
    'Religion',
    'Herbalism Kit',
  ],
  languages: ['Common', 'Elvish', 'Gnomish'],
  equipment: [
    'Shortsword',
    '10 Darts',
    "Explorer's Pack",
    'Holy Symbol',
    'Prayer Book',
    'Common Clothes',
    'Herbalism Kit',
    'Scroll case with notes',
    'Winter Blanket',
    'Set of Common Clothes',
    'Belt Pouch',
  ],
  inventory: [
    'Shortsword',
    '10 Darts',
    "Explorer's Pack (contains a backpack, bedroll, mess kit, tinderbox, 10 torches, 10 days of rations, waterskin, 50 feet of hempen rope)",
    'Holy Symbol of the Tranquil Way',
    'Prayer Book of the Ancient Monks',
    'Simple Robes',
    'Herbalism Kit',
    'Scroll case containing philosophical notes and meditations',
    'Winter Blanket',
    "Traveler's Clothes",
    'Belt Pouch with 10 gold pieces',
  ],
  bonds: 'Protecting the ancient elven traditions and the sanctity of the natural world.',
  flaws: 'Often too quick to judge those who lack discipline or respect for ancient teachings.',
  ideals:
    'Self-improvement: The path to enlightenment and true power is through constant mental and physical effort.',
  notes:
    'Elora was raised in a secluded monastery deep within the Whisperwood, dedicated to a blend of elven mysticism and martial arts. She travels the world seeking inner peace and to understand the disruptions to the natural order.',
  personalityTraits:
    'Quiet and observant, Elora speaks only when necessary, often conveying more with a knowing glance than with words. She moves with an effortless grace, even in everyday tasks.',
  avatarUrl,
  uid,
}

const characterId = await characterRepository.addDocument({
  createData: characterCreateData,
  getCollectionPathArgument: { uid },
})

console.log('Character document created with id:', characterId)
