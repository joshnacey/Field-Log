# Field Log — Dark Glassmorphic Redesign (v2)

A full dark-first, glassmorphic restyle of Field Log. This is the bigger visual swing
requested after the first (v1) pass read as too subtle. Reference aesthetic: Whoop,
Oura, Arc, Linear, Cash App — deep dark base, translucent glass surfaces, glowing rust
accents, big confident display type, and floating UI.

**No business logic, Firebase calls, data fetching (USGS / Open-Meteo), routing,
offline-queue, or GPS/weather behavior was changed.** This is a pure visual layer. The
tactical / fly-fishing brand identity (terracotta / olive / cream, Bebas Neue /
JetBrains Mono / Inter, After-Action Reviews, "The Read") is preserved — re-lit for
dark, not replaced.

## Global foundations

- **`src/index.css`** — rebuilt as a dark design system:
  - Dark palette CSS variables: `--bg #12140D` (near-black with an olive hue), `--panel
    #171A0F`, cream text `--ink #ECE7D8`, sage `--olive #A8B07A`, translucent `--line`,
    muted/faint text tuned for dark.
  - **Glass surfaces** — `.glass` / `.glass-strong`: translucent white fills
    (rgba .045/.07), 1px light border (rgba .1), `backdrop-filter: blur()`, and a subtle
    inner top highlight.
  - **Glow accents** — `.glow-rust` and `.glow-rust-soft` add a soft terracotta
    `box-shadow` halo, used sparingly on primary actions and the active nav item.
  - Dark elevation shadows (black-based), dark olive header gradient, `.overlay-blur`
    now a near-black blurred scrim.
  - **`.chip-scroll`** — `mask-image` linear-gradient fade on both edges of horizontal
    chip rows so overflowing chips fade out instead of hard-clipping.
  - Inputs: dark translucent fields with a rust focus ring + glow; dark placeholder.
  - Dark scrollbars, dark Leaflet (tiles dimmed via filter, dark popups/controls), and
    dark Recharts tooltip (dark fill, light item text, sage label).
- **`tailwind.config.js`** — `theme.extend` colors/shadows remapped to the dark palette
  (`bg`, `panel`, cream `ink`, sage `olive`, `rustlt`, translucent `line`, `glow`
  shadow); `darkMode: "class"`.
- **`index.html`** — `theme-color` set to the dark base `#12140D`.

## Component-level changes (`src/App.jsx`)

- **Color constants remapped** — `INK` → cream text, `OLIVE` → sage (readable on dark),
  new `BG` / `PANEL` / `RUST_LT`. All light surface/border/muted hexes were swept to
  dark translucent equivalents throughout every view.
- **Header / hero** — larger `FIELD LOG` wordmark (text-5xl), wider tracking, dark olive
  gradient panel with subtle texture.
- **Floating capsule bottom nav** — replaced the full-width flat bar with a centered,
  floating `.glass-strong` pill that sits above the screen edge (safe-area aware). The
  active tab is a filled rust gradient circle with a glow, not just a top accent line.
- **Guide bar / sync bar** — dark surfaces; sign-out pill and status colors retained.
- **Avatar profile popover** — dark `PANEL` sheet with the gradient header.
- **Cards (EntryCard / AARCard / map spots / ChartBlock / "The Read")** — dark glassy
  surfaces (translucent fill + light hairline border) with dark elevation and hover lift.
- **Buttons** — primary actions keep the rust gradient and now carry a soft rust glow
  (`.glow-rust-soft`); secondary = sage outline; disabled = muted.
- **Tag / badges** — rust-tint pills on dark; the "no conditions logged" muted variant
  restyled for dark.
- **Chips (filters + suggestions)** — dark glassy pills with light borders, gradient +
  glow active state, and the new scroll-edge fade mask.
- **Modals (Catch, AAR, both delete confirms)** — dark `PANEL` sheets, strong near-black
  blur backdrop, gradient header accent, spring-like entrance (slide/scale eased with a
  softer cubic-bezier). **`AARDeleteConfirm` buttons were brought in line** with
  `DeleteConfirm` (rounded-2xl, press, rust gradient + glow) — fixing the v1
  inconsistency.
- **MapView** — dark map frame; **the map container stays mounted** and is toggled with
  `display:none` when empty, so Leaflet initialization timing is unchanged. Dark
  loading/error overlays; dark popups.
- **Charts (Recharts)** — dark tooltip, light axis tick text, translucent gridlines;
  best/top bar highlighted in rust, the rest in sage.

## Verification

- `npm run build` — **production build succeeds with no errors** (the Vite >500 kB
  chunk-size note is pre-existing and informational only).
- Built output is in `dist/` for preview.

## Branch

All changes committed on **`modern-redesign`**, on top of the existing v1 history.
`main` is untouched; nothing was pushed or merged.
