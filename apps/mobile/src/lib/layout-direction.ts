import { I18nManager } from "react-native";

/**
 * Writing direction for the chosen language.
 *
 * React Native decides left-to-right or right-to-left once, when the process starts, from a flag it keeps
 * natively; `forceRTL` writes that flag for the *next* start. So the language picker cannot flip the layout in
 * place — the most it can do is record the direction and ask for a restart, which is what this returns.
 *
 * `allowRTL(true)` is the other half: without it the flag is ignored and every RTL language renders mirrored
 * the wrong way, with the back arrow pointing into the screen.
 */
export function applyLayoutDirection(rtl: boolean): boolean {
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.forceRTL(rtl);
  return true;
}
