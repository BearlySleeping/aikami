// scripts/visual_manifest.ts
//
// Visual regression test definitions for AI-powered screenshot comparison.
// Each entry defines what the AI should check when comparing our implementation
// against the reference design from nordclaw.lovable.app.

export type ValidationType = 'design' | 'state';

export type VisualTestDef = {
  type: ValidationType;
  referencePath?: string; // Only required for 'design' type
  instructions: string; // Plain English rules for the AI
  priority: number; // 1 (Core) to 3 (Edge cases)
};

export const VISUAL_MANIFEST: Record<string, VisualTestDef> = {
  // ──── Home page sections ────
  'home-desktop': {
    type: 'design',
    referencePath: 'home/desktop/screen.png',
    priority: 1,
    instructions: `
Compare the full home page against the reference design. Check:
- Hero section: headline "Sovereign AI that survives a CISO review" in Instrument Serif
- Emerald signal (#0f766e) for CTA buttons and accent text
- Trust bar with 6 items (Hetzner Frankfurt, Zero-data-retention LLMs, etc.)
- "Why Chat exists" section with 4 numbered cards
- Persona cards: Mia, Atlas, Clara, Nexus in a 4-column grid
- Use cases section with 3 cards (Logistics, Banking, Manufacturing)
- Walled Garden strip with manifest.json preview card
- Comparison table: NordClaw vs US SaaS vs EU competitors
- Pricing section with 3 tier cards
- Bottom CTA block "Ship in production by Friday"
- Overall parchment cream background with navy ink text
- Correct typography: Instrument Serif for headings, Inter for body, JetBrains Mono for labels
`.trim(),
  },

  'home-mobile': {
    type: 'design',
    referencePath: 'home/mobile/screen.png',
    priority: 2,
    instructions: `
Compare the mobile home page (375px) against the reference design. Check:
- Single-column layout, no horizontal scroll
- Hero section stacks vertically (copy above chat widget)
- Persona cards stack to 2-column or single column
- Pricing cards stack vertically
- Comparison table is horizontally scrollable
- Trust bar wraps to multiple lines
- Chat chat widget is compact and fits within viewport
- All text remains readable (no tiny/clipped text)
- Navigation is hamburger menu (not desktop nav)
`.trim(),
  },

  // ──── Sub-pages (desktop only for core pages) ────
  'pricing-desktop': {
    type: 'design',
    referencePath: 'pricing/desktop/screen.png',
    priority: 1,
    instructions: `
Compare the pricing page against the reference. Check:
- Three tier cards: Design Partner (€1), Standard (€39), Regulated (€99)
- "Most regulated" badge on the Regulated tier
- Feature lists with check marks per tier
- Cost breakdown section (run rate, DPA review, Cyber Essentials)
- Emerald signal CTA buttons on highlighted tier
- Clean parchment background with navy headings
`.trim(),
  },

  'trust-desktop': {
    type: 'design',
    referencePath: 'trust/desktop/screen.png',
    priority: 1,
    instructions: `
Compare the trust center page against the reference. Check:
- Headline "Built for the CISO who says no."
- Three key stats (Data residency, Audit log retention, Customer data egress)
- Sub-processors table with 6 entries, processor/region/certs columns
- 8-stage screening grid (numbered 01-08)
- DPA section with pre-signed badge and request button
- Anchor links at top: Sub-processors, 8-stage screening, DPA
- US exposure column with green "No" badges
`.trim(),
  },

  'compare-desktop': {
    type: 'design',
    referencePath: 'compare/desktop/screen.png',
    priority: 1,
    instructions: `
Compare the comparison page against the reference. Check:
- Headline "We won't beat Copilot on price."
- 8-column comparison table (NordClaw highlighted column)
- 10 rows of features
- Green checkmarks for NordClaw, dashes for missing features
- "Pick Copilot if" / "Pick n8n if" / "Pick NordClaw if" cards at bottom
- Source attribution text at bottom of table
`.trim(),
  },

  'contact-desktop': {
    type: 'design',
    referencePath: 'contact/desktop/screen.png',
    priority: 2,
    instructions: `
Compare the contact page against the reference. Check:
- Two-column layout: copy on left, form on right
- Contact info (email, press, security, office) on left
- Form fields: Full name, Work email, Organisation, Sector, Workflow textarea
- "Apply for design partner cohort" submit button in signal green
- Success state after form submit
`.trim(),
  },

  'walled-garden-desktop': {
    type: 'design',
    referencePath: 'walled-garden/desktop/screen.png',
    priority: 2,
    instructions: `
Compare the walled garden page against the reference. Check:
- 8-stage pipeline displayed as numbered rows
- Each row: number, title, description, automation type
- FAQ section with 3 common objections
- "View the live manifest" CTA button
- "Submit a capability for audit" secondary button
`.trim(),
  },

  'compliance-desktop': {
    type: 'design',
    referencePath: 'compliance/desktop/screen.png',
    priority: 2,
    instructions: `
Compare the compliance page against the reference. Check:
- EU AI Act articles grid (Article 11, 13, 26, 27, 50, 53)
- Three compliance cards (GDPR trust stack, ISO 27001 readiness, Data residency)
- "Not a burden. A sales argument." headline
`.trim(),
  },

  'personas-desktop': {
    type: 'design',
    referencePath: 'personas/desktop/screen.png',
    priority: 3,
    instructions: `
Compare the personas page against the reference. Check:
- Four persona cards: Mia, Atlas, Clara, Nexus
- Each card: name, tag, company, risk level, summary, wins, non-negotiables
- "Four people. One platform." headline
`.trim(),
  },

  'investors-desktop': {
    type: 'design',
    referencePath: 'investors/desktop/screen.png',
    priority: 3,
    instructions: `
Compare the investors page against the reference. Check:
- "€2.0M seed" callout box
- 6 stat cards in a grid
- Thesis section with 3 paragraphs
- Round allocation breakdown
- Milestones timeline
`.trim(),
  },

  'manifest-desktop': {
    type: 'design',
    referencePath: 'manifest/desktop/screen.png',
    priority: 3,
    instructions: `
Compare the manifest page against the reference. Check:
- "LIVE · v1.0.4" status indicator
- curl command code block
- YubiKey signing info
- 5-entry capability table (Microsoft 365, Google Workspace, Salesforce, Slack, HubSpot)
- Status badges (approved green, in review amber)
- 3 stat cards at bottom (Sub-processors, Hyperscaler exposure, Webhook subscribers)
`.trim(),
  },

  'eu-ai-act-desktop': {
    type: 'design',
    referencePath: 'eu-ai-act/desktop/screen.png',
    priority: 3,
    instructions: `
Compare the EU AI Act page against the reference. Check:
- "2 August 2026 · 90 days" deadline banner
- 6 article cards in a grid
- 4 deployer scenario rows (Mia, Atlas, Clara, Nexus)
- Each scenario: persona, title, risk, obligations list, compliance timeline
- Bottom CTA for compliance pack
`.trim(),
  },

  'use-cases-desktop': {
    type: 'design',
    referencePath: 'use-cases/desktop/screen.png',
    priority: 3,
    instructions: `
Compare the use cases page against the reference. Check:
- 4 use case cards in 2-column grid
- Department labels (Operations, C-Level, All, Finance)
- "live" / "Q3 · in build" status badges
- Metric numbers in signal green
`.trim(),
  },

  'chat-initial-state': {
    type: 'state',
    priority: 1,
    instructions: `
Verify the INITIAL STATE of the Chat chat widget. Check:
- Compact card with rounded corners and shadow
- Header: Chat with gradient avatar (S circle, green-to-amber), "online" dot, "AI consultant · online" text, "EU · Frankfurt" tag
- Greeting message: "Hej — I'm Chat, NordClaw's in-house AI consultant..."
- 4 starter prompt chips (Logistics cost-cutting, HR CV screening, Bank AI security, 90-day AI pilot)
- Input area with "Ask Chat anything…" placeholder
- Send button in signal green, initially disabled
- Widget height approximately h-[560px]
`.trim(),
  },

  // ─────────────────────────────────────────────
  // PWA Dashboard Views (SvelteKit)
  // Reference: to be captured from a Lovable PWA prototype
  // Priority: 1 = Core workflow, 2 = Important, 3 = Admin/Edge
  // ─────────────────────────────────────────────

  'pwa-dashboard-desktop': {
    type: 'design',
    referencePath: 'pwa-dashboard/desktop/screen.png',
    priority: 1,
    instructions: `
Compare the PWA dashboard view (desktop 1280×900) against the reference. Check:
- Top-left: App title "NordClaw" in Instrument Serif with emerald accent
- Navigation drawer on the left: Dashboard, Agents, Chat, Teams, Triage, Settings, Logs
- Active nav item highlighted with emerald left border
- Main content area: welcome greeting with user name and date
- Quick-action cards in a 2×2 or 3-column grid (New Agent, Review Queue, Team Activity, System Health)
- Each quick-action card: icon, title, description, emerald CTA button
- Stats row above or within cards: active agents count, pending approvals, emails processed
- Recent activity feed below cards with timestamped entries
- App bar at top: hamburger toggle (mobile only), app title, user avatar dropdown
- Overall parchment cream background, white cards, navy ink text
- Correct typography: Instrument Serif for app title, Inter for body, JetBrains Mono for stats
`.trim(),
  },

  'pwa-dashboard-mobile': {
    type: 'design',
    referencePath: 'pwa-dashboard/mobile/screen.png',
    priority: 2,
    instructions: `
Compare the PWA dashboard view (mobile 375×812) against the reference. Check:
- Navigation drawer hidden by default (hamburger menu in app bar)
- Single-column layout for quick-action cards (stacked vertically)
- Stats row wraps to 2 columns on mobile
- Activity feed takes full width
- App bar: hamburger icon, app title, user avatar
- All text remains readable at mobile width
- No horizontal scroll
- Navigation drawer slides in from left when hamburger tapped
`.trim(),
  },

  'pwa-triage-desktop': {
    type: 'design',
    referencePath: 'pwa-triage/desktop/screen.png',
    priority: 1,
    instructions: `
Compare the PWA email triage view (desktop 1280×900) against the reference. Check:
- Page title "Email Triage" or similar in Instrument Serif
- Filter bar: All / Pending / Approved / Rejected tabs or chips
- Email list/cards showing: subject, sender, snippet, received time
- Each email card with status badge (pending=amber, approved=green, rejected=red)
- Click on email expands detail view with full body, AI suggestion, action buttons
- Action buttons: Approve (emerald), Reject (red/outline), Skip (neutral)
- AI suggestion panel showing reasoning for triage decision
- Pagination or infinite scroll at bottom
- Empty state when no emails: illustration + "No emails to triage" text
`.trim(),
  },

  'pwa-teams-desktop': {
    type: 'design',
    referencePath: 'pwa-teams/desktop/screen.png',
    priority: 2,
    instructions: `
Compare the PWA teams view (desktop 1280×900) against the reference. Check:
- Page title "Teams" in Instrument Serif
- Team list as cards or table rows: team name, member count, role badge
- "Create Team" button in emerald (top right)
- Click on team navigates to team detail view
- Team detail shows: members list, email connections, activity log
- Invite flow: modal/dialog with email input, role dropdown, send button
- Accept invite view: team name, inviter, accept/reject buttons
- Empty state for no teams: "You haven't joined any teams yet"
`.trim(),
  },

  'pwa-settings-desktop': {
    type: 'design',
    referencePath: 'pwa-settings/desktop/screen.png',
    priority: 2,
    instructions: `
Compare the PWA settings view (desktop 1280×900) against the reference. Check:
- Page title "Settings" in Instrument Serif
- Settings grouped in cards/sections: Profile, Notifications, Appearance, Account
- Profile section: display name, email (read-only), avatar upload
- Notification section: toggle switches for email, push, in-app
- Theme/language selectors (dropdown)
- Account section: sign out button, delete account (danger zone with red styling)
- Form fields follow DaisyUI input-bordered pattern
- Save button per section or global save in emerald
- Settings navigation could be sidebar tabs or vertical sections
`.trim(),
  },

  'pwa-chat-desktop': {
    type: 'design',
    referencePath: 'pwa-chat/desktop/screen.png',
    priority: 2,
    instructions: `
Compare the PWA chat view (desktop 1280×900) against the reference. Check:
- Chat interface with message list and input area
- Messages: user messages right-aligned (different background), agent messages left-aligned
- Each message: avatar (user/agent), content, timestamp
- Agent messages show thinking/typing indicator during processing
- Input area at bottom: text input, send button (emerald)
- Chat header shows agent name and online/offline status
- Scroll behavior: auto-scroll to bottom on new messages
- Empty state: welcome message from agent
`.trim(),
  },

  'pwa-setup-desktop': {
    type: 'design',
    referencePath: 'pwa-setup/desktop/screen.png',
    priority: 3,
    instructions: `
Compare the PWA setup wizard view (desktop 1280×900) against the reference. Check:
- Multi-step wizard with progress indicator (step 1 of N)
- Steps: Welcome → Connect Email → Configure Agents → Done
- Each step has a clear heading, description, and form fields
- Navigation: Back (outline) and Next/Finish (emerald) buttons
- Progress dots or stepper at top showing current step
- Welcome step: app logo, value proposition, "Get Started" button
- Email step: OAuth connection flow with Gmail button
- Complete step: success checkmark, summary of setup, "Go to Dashboard" CTA
`.trim(),
  },

  'pwa-logs-desktop': {
    type: 'design',
    referencePath: 'pwa-logs/desktop/screen.png',
    priority: 3,
    instructions: `
Compare the PWA logs view (desktop 1280×900) against the reference. Check:
- Page title "System Logs" or "Activity Log" in Instrument Serif
- Filter bar: log level dropdown (DEBUG, INFO, WARNING, ERROR), date range picker
- Log entries in a table or feed: timestamp, level badge (color-coded), source, message
- ERROR entries highlighted in red/rose background
- WARNING entries in amber
- INFO entries in neutral
- DEBUG entries in muted
- Pagination or infinite scroll
- "Clear filters" or "Refresh" button
- Empty state: "No logs matching filters"
`.trim(),
  },
};
