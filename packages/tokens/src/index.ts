/**
 * Design tokens shared by web and mobile. Dark-first: the player and feed live on near-black.
 *
 * The palette is the reference app's, taken from its `res/values/colors.xml` rather than reinvented: crimson
 * primary on a neutral near-black, with gold for anything premium. Matching it is the point — this product is
 * a rebuild of that one, and a different hue makes every screen read as a different product no matter how
 * closely the layouts agree.
 *
 * The earlier palette here was orange, derived from the brand mark, because the mark's own red (#D40A2C) only
 * reaches 3.7:1 on a dark ground and body text needs 4.5. That was the right constraint and the wrong answer:
 * the reference hits the same constraint and solves it by lightening the red rather than abandoning it.
 * #F42452 is 4.9:1 on the ground and 4.6:1 on a card, so the product can be red after all. The mark's own
 * gradient is kept below for drawing the logo itself.
 */
export const colors = {
  // Neutrals are the reference's, and deliberately neutral rather than warm: a warm-tinted grey next to a
  // crimson accent shifts the whole surface pink.
  ground: "#0A0A0A",
  surface: "#141414",
  surface2: "#242427",
  ink: "#FAFAFA",
  ink2: "#D4D4D8",
  muted: "#A1A1AA",
  /**
   * Hairline borders. On this ground nothing subtle enough to read as a hairline also clears 3:1, so there are
   * two: `line` divides content that is already grouped, `lineStrong` is for anything whose edge is the only
   * thing saying it is a control (inputs, focus rings, table rules).
   */
  line: "#3A3A40",
  lineStrong: "#5E5E66",
  /** The reference's primary. Filled controls take `accentInk` for their label, which is 4.9:1 on it. */
  accent: "#F42452",
  accentHover: "#FF4E73",
  accentInk: "#12080B",
  /** VIP, coins and anything premium. The reference uses one gold for all of it. */
  gold: "#EAB308",
  goldHover: "#FACC15",
  /** The mark's own gradient, for the logo and the few places the brand is drawn rather than referenced. */
  brandFrom: "#FDC125",
  brandTo: "#D40A2C",
  success: "#34D399",
  /**
   * Amber sits close to `gold`, which is deliberate and no longer a problem. The collision that mattered was
   * with the accent: an amber badge beside an orange button read as one colour. Against crimson both are 56
   * degrees away, and gold and warning never appear on the same control.
   */
  warning: "#FBBF24",
  /**
   * Error text only. It is close in hue to the accent, which is unavoidable when the brand itself is red, and
   * tolerable because the two never compete: `danger` is only ever a caption, `accent` is only ever a fill.
   * They are separated by lightness instead, 8.7:1 against 4.9:1.
   */
  danger: "#FF8A8A",
  // Semantic roles every component was previously inventing inline as bg-black/40, rgba(0,0,0,0.45), and so on.
  scrim: "rgba(10, 10, 10, 0.72)",
  overlay: "rgba(0, 0, 0, 0.45)",
  focus: "#F42452",
  disabled: "#6B6B73",
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
