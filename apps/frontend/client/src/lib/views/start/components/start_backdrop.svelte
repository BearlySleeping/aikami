<script lang="ts">
// apps/frontend/client/src/lib/views/start/components/start_backdrop.svelte
//
// Ambient backdrop for the start menu — two slow-drifting brand-coloured
// glows over a faint rune grid, with a vignette that sinks the edges into
// base-100. Purely decorative: no props, no state, aria-hidden, and every
// animation is dropped under prefers-reduced-motion.
</script>

<div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
  <!-- Rune grid — a faint lattice that keeps the empty space from reading flat. -->
  <div class="grid-veil absolute inset-0 text-base-content"></div>

  <!-- Brand glows -->
  <div
    class="drift-a absolute -top-[30vmax] left-1/2 h-[70vmax] w-[70vmax] -translate-x-1/2 rounded-full bg-primary/25 blur-[110px]"
  ></div>
  <div
    class="drift-b absolute -bottom-[25vmax] -left-[15vmax] h-[55vmax] w-[55vmax] rounded-full bg-accent/15 blur-[110px]"
  ></div>
  <div
    class="drift-c absolute -right-[20vmax] top-1/3 h-[45vmax] w-[45vmax] rounded-full bg-secondary/10 blur-[110px]"
  ></div>

  <!-- Vignette — keeps the menu column readable over the glows. -->
  <div class="absolute inset-0 bg-gradient-to-b from-base-100 via-transparent to-base-100"></div>
  <div class="absolute inset-0 vignette"></div>
</div>

<style>
.grid-veil {
  opacity: 0.045;
  background-image:
    linear-gradient(to right, currentColor 1px, transparent 1px),
    linear-gradient(to bottom, currentColor 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse at 50% 40%, black 10%, transparent 70%);
}

.vignette {
  background: radial-gradient(
    ellipse at 50% 35%,
    transparent 35%,
    color-mix(in oklch, var(--color-base-100) 85%, transparent) 100%
  );
}

@keyframes drift {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(2%, 3%, 0) scale(1.08);
  }
}

.drift-a,
.drift-b,
.drift-c {
  animation: drift 26s ease-in-out infinite;
  will-change: transform;
}

/* The -translate-x-1/2 on .drift-a is a utility transform the keyframes would
   overwrite, so its centring is re-applied inside the animation instead. */
@keyframes drift-centred {
  0%,
  100% {
    transform: translate3d(-50%, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(-48%, 3%, 0) scale(1.08);
  }
}

.drift-a {
  animation-name: drift-centred;
}

.drift-b {
  animation-duration: 34s;
  animation-direction: reverse;
}

.drift-c {
  animation-duration: 42s;
  animation-delay: -8s;
}

@media (prefers-reduced-motion: reduce) {
  .drift-a,
  .drift-b,
  .drift-c {
    animation: none;
  }

  .drift-a {
    transform: translate3d(-50%, 0, 0);
  }
}
</style>
