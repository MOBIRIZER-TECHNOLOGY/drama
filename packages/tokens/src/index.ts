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
  accent: "#F05A72",
  accentHover: "#F37286",
  accentInk: "#1A0D11",
  gold: "#E0B44A",
  goldHover: "#E9C46B",
  success: "#8ED1AE",
  warning: "#E9A968",
  danger: "#F09AA6",
  // Semantic roles every component was previously inventing inline as bg-black/40, rgba(0,0,0,0.45), and so on.
  scrim: "rgba(20, 16, 19, 0.72)",
  overlay: "rgba(0, 0, 0, 0.45)",
  focus: "#F05A72",
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
