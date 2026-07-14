<script lang="ts">
/**
 * Props for the CharacterCard component.
 * Displays character information including name, avatar, race/class/level, and personality details.
 */
type Props = {
  /** The character's display name */
  name: string;
  /** URL to the character's avatar image */
  avatarUrl?: string;
  /** The character's race (e.g., Human, Elf, Dwarf) */
  race?: string;
  /** The character's class (e.g., Warrior, Mage, Rogue) */
  characterClass?: string;
  /** The character's current level */
  level?: number;
  /** Brief personality trait description */
  personalityTraits?: string;
  /** Character background/backstory */
  background?: string;
  /** Additional notes about the character */
  notes?: string;
  /** The character's greeting message */
  greeting?: string;
};

const {
  name,
  avatarUrl,
  race,
  characterClass,
  level,
  personalityTraits,
  background: _background,
  notes: _notes,
  greeting,
}: Props = $props();
</script>

<div class="card bg-base-200 shadow-sm">
  <div class="card-body p-4">
    <div class="flex items-start gap-4">
      {#if avatarUrl}
        <div class="avatar">
          <div class="w-16 rounded-lg"><img src={avatarUrl} alt={name}></div>
        </div>
      {/if}
      <div class="flex-1 min-w-0">
        <h3 class="card-title text-lg mb-1">{name}</h3>
        {#if race || characterClass || level}
          <p class="text-sm opacity-70">
            {#if race}
              {race}
            {/if}
            {#if characterClass}
              {race ? ' - ' : ''}{characterClass}
            {/if}
            {#if level}
              {race || characterClass ? ' - ' : ''}Level {level}
            {/if}
          </p>
        {/if}
        {#if personalityTraits}
          <p class="text-sm mt-2 line-clamp-2">{personalityTraits}</p>
        {/if}
      </div>
    </div>
    {#if greeting}
      <div class="mt-3 p-3 bg-base-100 rounded-lg border border-base-300">
        <p class="text-sm italic opacity-80">{greeting}</p>
      </div>
    {/if}
  </div>
</div>
