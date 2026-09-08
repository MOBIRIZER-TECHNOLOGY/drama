/** Design tokens shared by web and mobile. Dark-first: the player and feed live on near-black. */
export const colors = {
  ground: "#141013",
  surface: "#1F181B",
  surface2: "#2A2125",
  ink: "#F3ECEE",
  ink2: "#D9CDD1",
  muted: "#A99BA0",
  // Hairline borders. `line` was ~1.6:1 on `ground`, well under the 3:1 WCAG needs for a non-text boundary, so
  // on a cheap LCD in daylight the whole card system disappeared. Lifted, with `lineStrong` for anything that
  // has to read as an edge (inputs, table rules, focus outlines).
  line: "#3E3338",
  lineStrong: "#554750",
  /**
   * Taken from the brand mark, which runs amber to red.
   *
   * The mark's deep red (#D40A2C) only reaches 3.5:1 on `ground`, well under the 4.5 body text needs, so the
   * accent is the gradient's midpoint rather than either end — still a colour that is literally in the logo,
   * and comfortable at 6.1:1. The two ends are kept below for anywhere the gradient itself is drawn.
   */
  accent: "#F0692A",
  accentHover: "#F47A3C",
  accentInk: "#1A0A10",
  /** VIP and premium: the amber body of the mark's left page. */
  gold: "#F5A31A",
  goldHover: "#FDC125",
  /** The mark's own gradient, for the logo and the few places the brand is drawn rather than referenced. */
  brandFrom: "#FDC125",
  brandTo: "#D40A2C",
  success: "#8ED1AE",
  // Pushed yellow, away from the accent. An amber warning sat 11 degrees from an orange brand, which on a
  // badge beside a button reads as the same colour; at 45 degrees it reads as a different thing entirely.
  warning: "#F2CE5E",
  danger: "#F09AA6",
  // Semantic roles every component was previously inventing inline as bg-black/40, rgba(0,0,0,0.45), and so on.
  scrim: "rgba(20, 16, 19, 0.72)",
  overlay: "rgba(0, 0, 0, 0.45)",
  focus: "#F0692A",
  disabled: "#6B5C62",
} as const;

export const radii = { sm: 6, md: 12, lg: 18, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const type = {
  display: "Bricolage Grotesque",
  body: "IBM Plex Sans",
  mono: "IBM Plex Mono",
} as const;

/**
 * One type scale for both platforms.
 *
 * There was no scale in the token package at all, so web used Tailwind's defaults and mobile hardcoded six
 * variants, and the two ladders did not correspond: mobile's `heading` was 17/22 while web's rail heading was
 * `text-lg`. Sizes are in px; mobile applies a per-script leading multiplier on top (see lib/typography.ts).
 */
export const fontSize = {
  display: 30,
  title: 22,
  heading: 17,
  body: 15,
  label: 13,
  caption: 12,
} as const;

export const lineHeight = {
  display: 36,
  title: 28,
  heading: 22,
  body: 21,
  label: 18,
  caption: 16,
} as const;

/**
 * Motion. Every transition in the product was a magic number — 700ms here, .18s there, 1.6s in a keyframe — so
 * nothing felt like it belonged to the same product.
 *
 * `fast` is for state on a control, `base` for something entering or leaving, `slow` for a deliberate reveal.
 * Durations are milliseconds; the easings are CSS timing functions (mobile reads the numbers).
 */
export const duration = { instant: 90, fast: 140, base: 220, slow: 360, deliberate: 700 } as const;
export const easing = {
  /** Default for anything entering: fast out of the gate, settles gently. */
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  /** Leaving: quick, because nobody watches something go. */
  exit: "cubic-bezier(0.4, 0, 1, 1)",
  /** A little overshoot, for something that should feel physical (a coin landing, a sheet snapping). */
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

/**
 * Elevation. The design rule is thin borders rather than drop shadows, which is right for the dark product
 * surfaces — but a modal over a busy table and a toast over a rail of cards both need to read as *above*, and
 * with no shadow token each invented its own or went without.
 */
export const elevation = {
  none: "none",
  raised: "0 1px 2px rgba(0, 0, 0, 0.28)",
  overlay: "0 8px 24px rgba(0, 0, 0, 0.42)",
  modal: "0 24px 64px rgba(0, 0, 0, 0.55)",
} as const;

/** Minimum interactive size. Below this a control is a mis-tap on a phone. */
export const touchTarget = 44;

/** Layering. Hardcoded z-indexes had already collided between the header, toasts and the shorts feed. */
export const zIndex = { base: 0, sticky: 30, nav: 40, header: 50, overlay: 60, modal: 70, toast: 80 } as const;
