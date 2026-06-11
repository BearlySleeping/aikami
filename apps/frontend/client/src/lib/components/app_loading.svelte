<div class="flex h-full w-full items-center justify-center p-8 delayed-loader">
  <span class="loading loading-spinner loading-lg text-primary"></span>
</div>

<style>
  .delayed-loader {
    /* Start completely invisible */
    opacity: 0;
    /* Fade in over 200ms, but WAIT 250ms before starting */
    animation: fadeIn 0.2s ease-in forwards 250ms;
  }

  @keyframes fadeIn {
    to {
      opacity: 1;
    }
  }
</style>
