<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/macros/+page.svelte
  //
  // Dev sandbox for the prompt template macro system (C-237 AC-5).
  // Split-panel: template editor with live macro autocomplete on the left,
  // live resolution output on the right. Preset editor below with CRUD.
  // DevToolsPanel with reset actions.

  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import MacroAutocomplete from '$lib/components/macro_autocomplete.svelte';
  import type { DevAction } from '$types';
  import { getMacrosSandboxViewModel } from '$views/macros/macros_sandbox_view_model.svelte.ts';
  import PresetEditorView from '$views/presets/preset_editor_view.svelte';
  import { getPresetEditorViewModel } from '$views/presets/preset_editor_view_model.svelte.ts';

  const sandboxViewModel = getMacrosSandboxViewModel({ className: 'MacrosSandboxViewModel' });
  const presetEditorViewModel = getPresetEditorViewModel({ className: 'PresetEditorViewModel' });

  // ── Autocomplete state ───────────────────────────────────────────────────

  let showAutocomplete = $state(false);
  let autocompleteTrigger = $state('');
  let autocompleteTop = $state(0);
  let autocompleteLeft = $state(0);
  let textareaElement: HTMLTextAreaElement | undefined = $state();

  /** Extracts the trigger text after the last `{{` from the textarea. */
  const extractTrigger = (): { trigger: string; position: number } | undefined => {
    const textarea = textareaElement;
    if (!textarea) {
      return undefined;
    }

    const cursorPos = textarea.selectionStart ?? 0;
    const textBeforeCursor = textarea.value.slice(0, cursorPos);

    // Find the last `{{` before cursor
    const lastOpen = textBeforeCursor.lastIndexOf('{{');
    if (lastOpen < 0) {
      return undefined;
    }

    // Check that there isn't a closing `}}` between `{{` and cursor
    const afterOpen = textBeforeCursor.slice(lastOpen + 2);
    if (afterOpen.includes('}}')) {
      return undefined;
    }

    return { trigger: afterOpen, position: lastOpen };
  };

  /** Handles input events on the template textarea. */
  const handleTextareaInput = (e: Event): void => {
    const target = e.target as HTMLTextAreaElement;
    sandboxViewModel.updateTemplate(target.value);

    const extracted = extractTrigger();
    if (extracted) {
      autocompleteTrigger = extracted.trigger;
      showAutocomplete = true;

      // Calculate position for the dropdown
      const textarea = textareaElement;
      if (textarea) {
        const rect = textarea.getBoundingClientRect();
        // Approximate position: use textarea's top-left with some offset
        autocompleteTop = rect.bottom + 4;
        autocompleteLeft = rect.left;
      }
    } else {
      showAutocomplete = false;
      autocompleteTrigger = '';
    }
  };

  /** Inserts a selected macro at the cursor position. */
  const handleMacroSelect = (name: string): void => {
    const textarea = textareaElement;
    if (!textarea) {
      return;
    }

    const cursorPos = textarea.selectionStart ?? 0;
    const textBeforeCursor = textarea.value.slice(0, cursorPos);
    const lastOpen = textBeforeCursor.lastIndexOf('{{');

    if (lastOpen < 0) {
      return;
    }

    const before = textarea.value.slice(0, lastOpen);
    const after = textarea.value.slice(cursorPos);
    const newValue = `${before}{{${name}}}${after}`;

    sandboxViewModel.updateTemplate(newValue);
    showAutocomplete = false;
    autocompleteTrigger = '';

    // Reposition cursor after the inserted macro
    requestAnimationFrame(() => {
      if (textareaElement) {
        const newCursorPos = lastOpen + name.length + 4; // `{{name}}`
        textareaElement.focus();
        textareaElement.setSelectionRange(newCursorPos, newCursorPos);
      }
    });
  };

  /** Closes the autocomplete dropdown. */
  const handleAutocompleteClose = (): void => {
    showAutocomplete = false;
    autocompleteTrigger = '';
  };

  // ── Focus handler to refresh autocomplete on click ──────────────────────

  const handleTextareaFocus = (): void => {
    const extracted = extractTrigger();
    if (extracted) {
      autocompleteTrigger = extracted.trigger;
      showAutocomplete = true;
      const textarea = textareaElement;
      if (textarea) {
        const rect = textarea.getBoundingClientRect();
        autocompleteTop = rect.bottom + 4;
        autocompleteLeft = rect.left;
      }
    }
  };

  // ── DevTools actions ────────────────────────────────────────────────────

  const devActions: DevAction[] = [
    {
      label: 'Reset All',
      onClick: () => {
        sandboxViewModel.resetAll();
        presetEditorViewModel.discardChanges();
      },
    },
    {
      label: 'Reset Context',
      onClick: () => {
        sandboxViewModel.resetContext();
      },
    },
    {
      label: 'Reset Template',
      onClick: () => {
        sandboxViewModel.updateTemplate(`You are roleplaying as {{char}}. {{personality}}

                    Character: {{description}}

                    Setting: {{scenario}}

                    Previous conversation:
                    {{history}}

                    User ({{user}}): {{message}}`);
      },
    },
  ];
</script>

<div class="flex flex-col h-screen">
  <!-- Signal for visual test runner's _waitForGameReady -->
  <div data-testid="game-ready" class="hidden"></div>

  <!-- Header -->
  <div class="px-6 pt-6 pb-2">
    <h1 class="text-2xl font-bold">Macro Template Sandbox</h1>
    <p class="text-sm text-base-content/60 mt-1">
      Live-edit templates with
      <code class="font-mono text-primary text-xs">&#123;&#123;macro&#125;&#125;</code>
      placeholders. Type <code class="font-mono text-primary text-xs">&#123;&#123;</code> to trigger
      autocomplete.
    </p>
  </div>

  <!-- Split panel: Template Editor → Resolution Output -->
  <div class="flex flex-1 min-h-0 gap-4 px-6 overflow-hidden">
    <!-- Left: Template editor + context -->
    <div class="flex flex-col w-1/2 min-w-0 gap-3 overflow-auto pr-2">
      <!-- Preset selector -->
      <div class="flex items-center gap-2">
        <span class="text-xs font-semibold uppercase tracking-wider text-base-content/50 shrink-0">
          Preset
        </span>
        <select
          class="select select-bordered select-sm flex-1"
          onchange={(e: Event) => {
            const target = e.target as HTMLSelectElement;
            if (target.value) {
              sandboxViewModel.selectPreset({ id: target.value });
            }
          }}
        >
          <option value="">-- Custom template --</option>
          {#each sandboxViewModel.presets as preset}
            <option value={preset.id}>{preset.name}{preset.isBuiltIn ? ' (built-in)' : ''}</option>
          {/each}
        </select>
      </div>

      <!-- Template textarea -->
      <div class="relative">
        <span
          class="text-xs font-semibold uppercase tracking-wider text-base-content/50 block mb-1"
        >
          Template
        </span>
        <textarea
          bind:this={textareaElement}
          class="textarea textarea-bordered w-full min-h-48 font-mono text-sm resize-y"
          value={sandboxViewModel.template}
          oninput={handleTextareaInput}
          onfocus={handleTextareaFocus}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === 'Escape' && showAutocomplete) {
              e.preventDefault();
              handleAutocompleteClose();
            }
          }}
        ></textarea>

        <!-- Macro autocomplete popover -->
        {#if showAutocomplete}
          <div class="fixed z-[9998]" style="top: {autocompleteTop}px; left: {autocompleteLeft}px;">
            <MacroAutocomplete
              trigger={autocompleteTrigger}
              onselect={handleMacroSelect}
              onclose={handleAutocompleteClose}
            />
          </div>
        {/if}
      </div>

      <!-- Context mock fields -->
      <div>
        <span
          class="text-xs font-semibold uppercase tracking-wider text-base-content/50 block mb-2"
        >
          Context Mock Values
        </span>
        <div class="grid grid-cols-2 gap-2">
          <label class="form-control">
            <span class="label-text text-xs">userName</span>
            <input
              type="text"
              class="input input-bordered input-xs font-mono"
              value={sandboxViewModel.userName}
              oninput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                sandboxViewModel.updateContext({ field: 'userName', value: target.value });
              }}
            >
          </label>
          <label class="form-control">
            <span class="label-text text-xs">characterName</span>
            <input
              type="text"
              class="input input-bordered input-xs font-mono"
              value={sandboxViewModel.characterName}
              oninput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                sandboxViewModel.updateContext({ field: 'characterName', value: target.value });
              }}
            >
          </label>
          <label class="form-control">
            <span class="label-text text-xs">personality</span>
            <input
              type="text"
              class="input input-bordered input-xs font-mono"
              value={sandboxViewModel.characterPersonality}
              oninput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                sandboxViewModel.updateContext({ field: 'characterPersonality', value: target.value });
              }}
            >
          </label>
          <label class="form-control">
            <span class="label-text text-xs">scenario</span>
            <input
              type="text"
              class="input input-bordered input-xs font-mono"
              value={sandboxViewModel.scenario}
              oninput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                sandboxViewModel.updateContext({ field: 'scenario', value: target.value });
              }}
            >
          </label>
          <label class="form-control col-span-2">
            <span class="label-text text-xs">characterDescription</span>
            <textarea
              class="textarea textarea-bordered textarea-xs w-full font-mono resize-none"
              rows={2}
              value={sandboxViewModel.characterDescription}
              oninput={(e: Event) => {
                const target = e.target as HTMLTextAreaElement;
                sandboxViewModel.updateContext({ field: 'characterDescription', value: target.value });
              }}
            ></textarea>
          </label>
          <label class="form-control">
            <span class="label-text text-xs">persona</span>
            <input
              type="text"
              class="input input-bordered input-xs font-mono"
              value={sandboxViewModel.persona}
              oninput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                sandboxViewModel.updateContext({ field: 'persona', value: target.value });
              }}
            >
          </label>
          <label class="form-control">
            <span class="label-text text-xs">otherCharacters</span>
            <input
              type="text"
              class="input input-bordered input-xs font-mono"
              value={sandboxViewModel.otherCharacters}
              oninput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                sandboxViewModel.updateContext({ field: 'otherCharacters', value: target.value });
              }}
            >
          </label>
          <label class="form-control col-span-2">
            <span class="label-text text-xs">chatHistory</span>
            <textarea
              class="textarea textarea-bordered textarea-xs w-full font-mono resize-none"
              rows={3}
              value={sandboxViewModel.chatHistory}
              oninput={(e: Event) => {
                const target = e.target as HTMLTextAreaElement;
                sandboxViewModel.updateContext({ field: 'chatHistory', value: target.value });
              }}
            ></textarea>
          </label>
          <label class="form-control">
            <span class="label-text text-xs">userMessage</span>
            <input
              type="text"
              class="input input-bordered input-xs font-mono"
              value={sandboxViewModel.userMessage}
              oninput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                sandboxViewModel.updateContext({ field: 'userMessage', value: target.value });
              }}
            >
          </label>
        </div>
      </div>
    </div>

    <!-- Right: Resolution output -->
    <div class="flex flex-col w-1/2 min-w-0">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs font-semibold uppercase tracking-wider text-base-content/50">
          Resolved Output
        </span>
        <span class="text-xs text-base-content/40 font-mono">
          {sandboxViewModel.characterCount}
          characters
        </span>
      </div>
      <pre
        class="bg-base-300 rounded-lg p-4 text-sm font-mono whitespace-pre-wrap break-words flex-1 overflow-auto min-h-48"
      >{sandboxViewModel.resolvedOutput || 'No content to preview.'}</pre>
    </div>
  </div>

  <!-- Bottom: Preset editor -->
  <div class="border-t border-base-300 mt-4 max-h-[40vh] overflow-auto">
    <PresetEditorView viewModel={presetEditorViewModel} />
  </div>
</div>

<DevToolsPanel actions={devActions} toggles={[]} />
