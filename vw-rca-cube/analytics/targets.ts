/**
 * The company's annual revenue target when Settings has none saved (2026-11-20: $120M, was $130M). Every goal, split and visual falls back
 * to this one number: the refresh's goal curve and top-down split, the read-time rescaling, the projection, the map, and the Settings field.
 * A target saved in Settings always wins. Pure, so the page can import it too.
 */
export const DEFAULT_ANNUAL_TARGET = 120_000_000;
