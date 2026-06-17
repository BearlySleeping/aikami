// apps/frontend/client/src/lib/types/dev_action.ts
//
// Dev Tools Panel action type — used by (dev) sandbox routes
// to register interactive dev tool buttons in the DevToolsPanel.

/** A single action button in the dev tools panel. */
export type DevAction = {
  /** Visible button label. */
  readonly label: string;
  /** Callback invoked on click. */
  onClick: () => void;
};

/** A single toggle (checkbox) in the dev tools panel. */
export type DevToggle = {
  /** Label shown next to the checkbox. */
  readonly label: string;
  /** Callback invoked when toggled. Receives the new checked state. */
  onChange: (checked: boolean) => void;
};
