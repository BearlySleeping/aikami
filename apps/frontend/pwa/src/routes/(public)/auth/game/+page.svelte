<script lang="ts">
  /**
   * @fileoverview Game auth bridge page - allows Godot game to authenticate via PWA
   * @description This page is opened from the Godot game for Google/email sign-in.
   * After successful auth, the Firebase ID token is displayed for copy/paste
   * and sent back to the opener via postMessage if available.
   */
  import { onMount } from 'svelte';
  import { firebaseAuthService } from '@aikami/frontend/services';
  import type { User } from 'firebase/auth';

  type AuthState = 'idle' | 'signing_in' | 'success' | 'error';

  let authState = $state<AuthState>('idle');
  let idToken = $state('');
  let errorMessage = $state('');
  let email = $state('');
  let password = $state('');
  let copied = $state(false);

  // Detect if opened from Godot game
  const isGameAuth = $derived(
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('game')
  );

  onMount(() => {
    if (!isGameAuth) {
      // If not opened from game, redirect to normal login
      window.location.href = '/login';
    }
  });

  async function handleGoogleSignIn(): Promise<void> {
    authState = 'signing_in';
    errorMessage = '';

    try {
      const response = await firebaseAuthService.signInWithPopup('google.com');

      if (response.status === 'failed') {
        throw new Error(response.payload.message || 'Google sign-in failed');
      }

      const user = response.status === 'exitingUser'
        ? response.payload
        : undefined;

      if (!user) {
        throw new Error('No user returned from Google sign-in');
      }

      await completeAuth(user);
    } catch (err) {
      authState = 'error';
      errorMessage = err instanceof Error ? err.message : 'Sign-in failed';
    }
  }

  async function handleEmailSignIn(): Promise<void> {
    if (!email || !password) {
      errorMessage = 'Please enter email and password';
      return;
    }

    authState = 'signing_in';
    errorMessage = '';

    try {
      const user = await firebaseAuthService.signInWithEmailAndPassword({ email, password });
      await completeAuth(user);
    } catch (err) {
      authState = 'error';
      errorMessage = err instanceof Error ? err.message : 'Invalid email or password';
    }
  }

  async function completeAuth(user: User): Promise<void> {
    try {
      const token = await firebaseAuthService.getIdToken(user, true);
      idToken = token;
      authState = 'success';

      // Try to send token back to opener (Godot game) via postMessage
      if (window.opener) {
        const origin = new URLSearchParams(window.location.search).get('origin') || '*';
        window.opener.postMessage(
          { type: 'GAME_AUTH_SUCCESS', token },
          origin
        );
      }
    } catch (err) {
      authState = 'error';
      errorMessage = err instanceof Error ? err.message : 'Failed to get auth token';
    }
  }

  function copyToken(): void {
    navigator.clipboard.writeText(idToken).then(() => {
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    });
  }

  function closeWindow(): void {
    window.close();
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-base-200 p-4">
  <div class="card w-full max-w-md bg-base-100 shadow-xl">
    <div class="card-body">
      <h1 class="text-2xl font-bold text-center mb-2">Sign In for Game</h1>
      <p class="text-center text-sm text-base-content/70 mb-6">
        Authenticate to sync your game progress
      </p>

      {#if authState === 'idle' || authState === 'signing_in'}
        <!-- Google Sign In -->
        <button
          class="btn btn-outline gap-2 mb-4"
          onclick={handleGoogleSignIn}
          disabled={authState === 'signing_in'}
        >
          {#if authState === 'signing_in'}
            <span class="loading loading-spinner loading-sm"></span>
            Signing in...
          {:else}
            <svg class="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          {/if}
        </button>

        <div class="divider">or</div>

        <!-- Email/Password Form -->
        <form
          class="flex flex-col gap-3"
          onsubmit={(e) => { e.preventDefault(); handleEmailSignIn(); }}
        >
          <input
            type="email"
            class="input input-bordered"
            placeholder="Email"
            bind:value={email}
            disabled={authState === 'signing_in'}
            autocomplete="email"
          />
          <input
            type="password"
            class="input input-bordered"
            placeholder="Password"
            bind:value={password}
            disabled={authState === 'signing_in'}
            autocomplete="current-password"
          />
          <button
            type="submit"
            class="btn btn-primary"
            disabled={authState === 'signing_in'}
          >
            {#if authState === 'signing_in'}
              <span class="loading loading-spinner loading-sm"></span>
            {/if}
            Sign In
          </button>
        </form>

        {#if errorMessage}
          <div class="alert alert-error mt-4">
            <span>{errorMessage}</span>
          </div>
        {/if}
      {:else if authState === 'success'}
        <div class="alert alert-success mb-4">
          <span>Sign-in successful!</span>
        </div>

        <p class="text-sm mb-2">
          Copy this token and paste it into the game:
        </p>

        <div class="join w-full">
          <input
            type="text"
            class="input input-bordered join-item flex-1 text-xs font-mono"
            value={idToken}
            readonly
          />
          <button
            class="btn join-item btn-primary"
            onclick={copyToken}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {#if window.opener}
          <p class="text-xs text-center text-base-content/60 mt-2">
            Token also sent automatically to the game.
          </p>
        {/if}

        <button class="btn btn-ghost btn-sm mt-4" onclick={closeWindow}>
          Close Window
        </button>
      {:else if authState === 'error'}
        <div class="alert alert-error mb-4">
          <span>{errorMessage}</span>
        </div>
        <button
          class="btn btn-primary"
          onclick={() => { authState = 'idle'; errorMessage = ''; }}
        >
          Try Again
        </button>
      {/if}
    </div>
  </div>
</div>
