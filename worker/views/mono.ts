/**
 * Mono measuring for the SVG views. An SVG loaded through an <img> cannot ask
 * a browser how wide a string is, so the layout has to know its own type: DM
 * Mono and every fallback in this stack sit at the same advance.
 */

export const MONO_STACK = "'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** DM Mono and every fallback in the stack sit at a 0.6em advance. */
export const ADVANCE = 0.6;

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

/** Cells, not characters: CJK is full-width, and a surrogate pair is one glyph. */
export function cells(text: string): number {
  return [...text].reduce((width, character) => width + (WIDE.test(character) ? 2 : 1), 0);
}

export function monoWidth(text: string, size: number): number {
  return cells(text) * size * ADVANCE;
}
