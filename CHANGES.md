# Modern Redesign — Visual Polish Pass

A pure visual/UI/CSS refresh of Field Log. **No business logic, Firebase calls, data
fetching (USGS / Open-Meteo), routing, offline-queue, or GPS/weather behavior was
changed.** The tactical / fly-fishing brand identity and terracotta / olive / cream
palette are preserved and elevated, not replaced.

## Global foundations

- **`src/index.css`** — expanded from a 6-line reset into a small design system:
  - CSS variables for the palette (rust, ink, paper, olive, line, muted, card, sand).
  - Font smoothing + `text-rendering` on `body`; fonts imported at the top so they load
    during the auth/loading states too.
  - Layered soft shadows (`.elev-1`, `.elev-2`, `.elev-header`, `.elev-nav`).
  - Gradients (`.grad-header` olive, `.grad-rust` terracotta) for hero/header, primary
    buttons, active chips, and toasts.
  - `.overlay-blur` — backdrop-blur overlay used by all modals/popovers instead of flat
    black scrims.
  - Micro-interaction utilities: `.lift` (hover raise / active settle on cards),
    `.press` (active scale + hover brightness on buttons), `.chip` (chip press).
  - Input polish: `.field-input` focus ring + placeholder color; global
    `:focus-visible` outline for accessibility.
  - Custom scrollbar (WebKit + Firefox).
  - Keyframes + classes: `fadeIn`, `slideUp`, `scaleIn`, `toastIn`, all gated behind
    `prefers-reduced-motion`.
  - Refined Leaflet popup / zoom-control and Recharts tooltip styling.
- **`tailwind.config.js`** — `theme.extend` now defines the brand colors, larger
  `rounded-2xl/3xl` radii, and `soft` / `lifted` box-shadows.

## Component-level changes (`src/App.jsx`)

- **Header / hero** — olive gradient + subtle paper texture, larger display type,
  wider tracking, deeper elevation. Logo is now a tappable avatar.
- **Avatar profile popover** (new, additive) — tapping the header avatar opens a small
  blurred popover showing the guide's initials, name, and email with a **Sign out**
  action that reuses the existing `signOut()` logic. No data model changes.
- **Guide bar / sign-out** — pill button with press feedback.
- **Bottom nav** — gradient bar, active tab gets a top accent bar, a tinted icon
  chip, bolded label, and smooth color transitions; respects `safe-area-inset-bottom`.
- **Toast** — terracotta gradient pill with slide/scale entrance animation.
- **LogView** — larger hero button with lift, refined "LOG CATCH" heading; loading and
  empty states now use shared components.
- **EntryCard / AARCard** — `rounded-2xl`, soft elevation, hover lift, clearer
  label-vs-value typography.
- **Badges (`Tag`)** — refined filled-tint pills; when a catch has **no GPS/conditions
  data**, a muted "no conditions logged" placeholder pill is shown instead of omitting
  badges entirely (visual-consistency fix).
- **Chips** (`FilterChips`, `ChipRow`) — consistent sizing, gradient active state with
  glow, press animation.
- **Empty states** — new shared `EmptyState` component gives **Map**, **Patterns**,
  **History**, and **AAR** a designed empty state matching LOG's quality; new
  `LoadingRow` for consistent loaders.
- **Buttons** — clear hierarchy everywhere: primary = terracotta gradient + elevation
  + press; secondary = olive outline; disabled = muted olive at reduced opacity.
- **Inputs** (`AuthField`, `Field`, `FieldArea`, manual-coordinate + Miss fields) —
  bordered rounded fields with focus rings instead of bare underlines.
- **Modals** (Catch, AAR, and both delete confirms) — backdrop-blur overlays,
  `rounded-3xl`, layered shadow, gradient headers, fade + slide/scale entrance
  animations, circular close buttons.
- **MapView** — rounded elevated map frame, designed empty state (map stays mounted via
  `display:none` so Leaflet initialization timing is unchanged), elevated Top Spots
  cards with #1 highlighted in rust.
- **Patterns / charts** — "The Read" and every chart now sit in elevated rounded cards;
  Recharts bars get larger rounded corners and capped width, softened axes/gridlines,
  and a shared refined tooltip style.

## Verification

- `npm install` then `npm run build` — **production build succeeds with no errors**
  (the Vite >500 kB chunk-size note is pre-existing and informational only).
- Built output is in `dist/` for preview.

## Branch

All changes committed on **`modern-redesign`** (branched off `main`). `main` is untouched;
nothing was pushed or merged.
