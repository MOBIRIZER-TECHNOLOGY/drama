/**
 * Script-aware type. Which face and how much leading a string needs depends on the script it is written in.
 *
 * The app previously shipped Bricolage Grotesque and IBM Plex Sans only, neither of which carries an Indic
 * glyph. So the moment a viewer picked Hindi — the app's primary language — every string fell back to whatever
 * the device happened to have, and the entire type system evaporated in the market the product is built for.
 *
 * Two things vary by script:
 *
 *  - The family. Latin keeps the brand pair; Devanagari, Tamil, Telugu and Bengali get their Noto Sans.
 *  - The leading. Indic scripts stack marks above and below the baseline, so Latin's line height clips matras
 *    and vowel signs. Each script carries a multiplier applied to the variant's Latin line height.
 *
 * Negative letter-spacing is Latin-only: on a connected or mark-heavy script it damages legibility.
 */

export type Script = "latin" | "devanagari" | "tamil" | "telugu" | "bengali";

/** Language code to script. Anything unlisted renders in the Latin pair, which is the correct default. */
const SCRIPT_BY_LANG: Record<string, Script> = {
  hi: "devanagari",
  mr: "devanagari",
  ne: "devanagari",
  sa: "devanagari",
  ta: "tamil",
  te: "telugu",
  bn: "bengali",
  as: "bengali",
};

export function scriptFor(lang: string | null | undefined): Script {
  const base = (lang ?? "").toLowerCase().split(/[-_]/)[0];
  return SCRIPT_BY_LANG[base] ?? "latin";
}

type Weight = "regular" | "medium" | "semiBold" | "bold";

const LATIN: Record<Weight, string> = {
  regular: "IBMPlexSans-Regular",
  medium: "IBMPlexSans-Medium",
  semiBold: "IBMPlexSans-SemiBold",
  bold: "IBMPlexSans-Bold",
};

function noto(script: "Devanagari" | "Tamil" | "Telugu" | "Bengali"): Record<Weight, string> {
  return {
    regular: `NotoSans${script}_400Regular`,
    medium: `NotoSans${script}_500Medium`,
    semiBold: `NotoSans${script}_600SemiBold`,
    bold: `NotoSans${script}_700Bold`,
  };
}

const FAMILIES: Record<Script, Record<Weight, string>> = {
  latin: LATIN,
  devanagari: noto("Devanagari"),
  tamil: noto("Tamil"),
  telugu: noto("Telugu"),
  bengali: noto("Bengali"),
};

/**
 * Display faces. Bricolage Grotesque has no Indic coverage, so an Indic script uses its Noto bold as the
 * display voice too. That keeps one voice per language rather than pairing a Latin display face with an Indic
 * body face, which reads as two different brands.
 */
const DISPLAY: Record<Script, { semiBold: string; bold: string }> = {
  latin: { semiBold: "BricolageGrotesque-SemiBold", bold: "BricolageGrotesque-Bold" },
  devanagari: { semiBold: "NotoSansDevanagari_600SemiBold", bold: "NotoSansDevanagari_700Bold" },
  tamil: { semiBold: "NotoSansTamil_600SemiBold", bold: "NotoSansTamil_700Bold" },
  telugu: { semiBold: "NotoSansTelugu_600SemiBold", bold: "NotoSansTelugu_700Bold" },
  bengali: { semiBold: "NotoSansBengali_600SemiBold", bold: "NotoSansBengali_700Bold" },
};

/** Extra leading each script needs over the Latin line height, so marks are never clipped. */
const LEADING: Record<Script, number> = {
  latin: 1,
  devanagari: 1.28,
  tamil: 1.3,
  telugu: 1.3,
  bengali: 1.26,
};

export function fontsFor(script: Script) {
  return {
    ...FAMILIES[script],
    displaySemiBold: DISPLAY[script].semiBold,
    displayBold: DISPLAY[script].bold,
  };
}

export function leadingFor(script: Script): number {
  return LEADING[script];
}

/** Tightened tracking is a Latin typographic device; on Indic scripts it damages legibility. */
export function trackingFor(script: Script, latinValue: number): number {
  return script === "latin" ? latinValue : 0;
}
