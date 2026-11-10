/*
 * Colour theme for the whole app, kept in this browser as a cookie so the
 * server renders the first paint in the chosen colours. "system" follows the
 * computer's light or dark setting. globals.css reads `data-theme` on <html>.
 */

export const THEME_COOKIE = "wordly-theme";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "light";

export function parseTheme(value: string | undefined): Theme {
  return (THEMES as readonly unknown[]).includes(value) ? (value as Theme) : DEFAULT_THEME;
}

/** The theme the button changes to: light, then dark, then match system, then light again. */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}
