// Temporary attach-only config used to run the C-516 combat_v2 spec against the
// already-running contract-scoped client dev server (no server lifecycle).
import base from './playwright.config';

const projects = Array.isArray(base.projects)
  ? base.projects.filter((project) =>
      ['setup', 'client'].includes(String(project.name)),
    )
  : [];

export default {
  ...base,
  projects,
  webServer: undefined,
};
