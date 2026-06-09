---
name: Cybernetic Orchestrator
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#c9c4d8'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#938ea1'
  outline-variant: '#484555'
  surface-tint: '#cabeff'
  primary: '#cabeff'
  on-primary: '#31009a'
  primary-container: '#937dff'
  on-primary-container: '#2a0088'
  inverse-primary: '#603de2'
  secondary: '#bdf4ff'
  on-secondary: '#00363d'
  secondary-container: '#00e3fd'
  on-secondary-container: '#00616d'
  tertiary: '#ffb0cb'
  on-tertiary: '#640036'
  tertiary-container: '#ff479c'
  on-tertiary-container: '#58002f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e6deff'
  primary-fixed-dim: '#cabeff'
  on-primary-fixed: '#1c0062'
  on-primary-fixed-variant: '#4717ca'
  secondary-fixed: '#9cf0ff'
  secondary-fixed-dim: '#00daf3'
  on-secondary-fixed: '#001f24'
  on-secondary-fixed-variant: '#004f58'
  tertiary-fixed: '#ffd9e3'
  tertiary-fixed-dim: '#ffb0cb'
  on-tertiary-fixed: '#3e001f'
  on-tertiary-fixed-variant: '#8d004f'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  headline-lg:
    fontFamily: JetBrains Mono
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.1em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 40px
  xl: 64px
  gutter: 20px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style

The brand personality is authoritative, technical, and hyper-efficient. It is designed for power users who manage complex AI workflows, requiring a UI that feels like a high-end terminal fused with modern glassmorphism.

The design style is **Glassmorphic-Industrial**. It leverages the depth and sophistication of frosted layers but maintains a rigorous, grid-based structure to ensure clarity in dense configuration environments. The aesthetic response should be one of "command and control"—providing the user with a sense of mastery over complex data through high-contrast accents and surgical precision.

## Colors

The palette is anchored in a "Deep Space" dark mode. 
- **Primary (Electric Violet):** Used for primary actions, active navigation states, and key brand moments.
- **Secondary (Neon Cyan):** Used for connectivity status, data visualization highlights, and secondary interactive elements.
- **Surface Strategy:** Backgrounds utilize a near-black charcoal. UI cards and modals use a semi-transparent slate with a 20px backdrop blur, creating a sense of layered complexity without visual noise.
- **Semantic Colors:** Status indicators (connected/saved) utilize high-vibrancy greens and ambers to stand out against the dark canvas.

## Typography

This system uses a dual-font approach to balance technical precision with readability.
- **JetBrains Mono** is reserved for headlines, labels, and technical data. This reinforces the "orchestration" and developer-centric nature of the product.
- **Inter** handles all long-form body copy and descriptions, ensuring that even dense configuration forms remain legible and accessible.
- **Visual Hierarchy:** Use `label-caps` for section headers and input labels to create a distinct separation between "The Tool" (UI) and "The Content" (User Data).

## Layout & Spacing

The layout follows a **Fixed-Fluid Hybrid** model. Navigation and sidebars are fixed-width to maintain tool accessibility, while the main configuration workspace is fluid with a maximum container width of 1440px to prevent excessive line lengths on ultrawide monitors.

- **Grid:** A 12-column grid is used for the main workspace.
- **Density:** High-density spacing (`base` to `sm`) is used within configuration cards to group related inputs. Generous outer spacing (`lg` to `xl`) is used between major sections to prevent cognitive overload.
- **Breakpoints:** 
  - Mobile (<768px): Single column, sidebars collapse into a bottom drawer.
  - Tablet (768px - 1024px): 8-column workspace, sidebar collapses to icons.
  - Desktop (>1024px): Full 12-column layout with persistent sidebar.

## Elevation & Depth

Hierarchy is established through **Tonal Stacking** and **Backdrop Blurs**:
- **Level 0 (Base):** `#0B0F1A` - The deep background layer.
- **Level 1 (Cards):** Semi-transparent slate with a 1px border (`rgba(255,255,255,0.05)`). Includes a `20px` backdrop blur.
- **Level 2 (Modals/Dropdowns):** Darker, less transparent slate with a primary-tinted outer glow (`0 8px 32px rgba(0,0,0,0.4)`).
- **Interactive States:** Elements should feel "tactile" through the use of inner shadows on active/pressed states, simulating a physical button press into the glass surface.

## Shapes

The shape language is "Soft-Industrial." While the grid is rigid, the corners are slightly softened (`0.25rem`) to prevent the UI from feeling hostile or overly "retro-brutalist."
- **Inputs & Buttons:** Use `rounded` (4px).
- **Cards & Modals:** Use `rounded-lg` (8px).
- **Status Pills:** Use `rounded-xl` or full pill shape to differentiate them from functional buttons.

## Components

### Buttons
- **Primary:** Solid `primary_color_hex` with white text. High-vibrancy glow on hover.
- **Ghost:** `primary_color_hex` border with transparent background. Fills on hover.

### Configuration Cards & Progressive Disclosure
- **Collapsible Cards:** Use a chevron icon on the right. The header remains visible, while the body slides out. Header background slightly lightens on hover to indicate interactivity.
- **Tabbed Navigation:** Underline style for active states using the `secondary_color_hex` (Neon Cyan). Inactive tabs use `label-caps` typography at 50% opacity.

### Status Indicators
- **Connected:** Small glowing dot (8px) using `success_hex` paired with a "CONNECTED" label in `code-sm`.
- **Progressive Saving:** When a field is updated, a brief `secondary_color_hex` pulse animation occurs on the input border.

### Input Fields
- **Technical Inputs:** Use `code-sm` font. Background is 10% lighter than the card surface.
- **Active State:** 1px solid `primary_color_hex` border with a subtle 4px outer blur.

### Chips & Tags
- Used for model features (e.g., "Vision", "Tools"). Small, low-contrast background with `label-caps` text.