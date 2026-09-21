/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#18181b',
    tint: '#f97316',

    // Core surfaces
    background: '#fafafa',
    foreground: '#18181b',

    // Cards / elevated surfaces
    card: '#ffffff',
    cardForeground: '#18181b',

    // Primary action color (buttons, links, active states)
    primary: '#f97316',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#f4f4f5',
    secondaryForeground: '#18181b',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#f4f4f5',
    mutedForeground: '#71717a',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#f4f4f5',
    accentForeground: '#18181b',

    // Destructive actions (delete, error states)
    destructive: '#ef4444',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#e4e4e7',
    input: '#e4e4e7',
  },
  dark: {
    text: '#fafafa',
    tint: '#f97316',
    background: '#18181b',
    foreground: '#fafafa',
    card: '#1f1f23',
    cardForeground: '#fafafa',
    primary: '#f97316',
    primaryForeground: '#ffffff',
    secondary: '#27272a',
    secondaryForeground: '#fafafa',
    muted: '#27272a',
    mutedForeground: '#a1a1aa',
    accent: '#27272a',
    accentForeground: '#fafafa',
    destructive: '#ef4444',
    destructiveForeground: '#ffffff',
    border: '#27272a',
    input: '#27272a',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
