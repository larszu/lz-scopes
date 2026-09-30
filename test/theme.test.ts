import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, HUD_STYLE, THEMES, isTheme } from '../src/theme';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
/** first `:root {` block = neutral skin and the shared tokens */
const neutralBlock = css.slice(css.indexOf(':root {'), css.indexOf("}\n/* skin \"lzm\""));
const neutralPart = neutralBlock.slice(neutralBlock.indexOf('/* skin "neutral"'))
  // status dots (8 px, live/connecting/error) are the only chromatic chrome, deliberately desaturated
  .split('\n').filter((l) => !l.includes('--ok:')).join('\n');

const hexes = (s: string) => [...s.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => m[1]);
const rgbas = (s: string) => [...s.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+)/g)].map((m) => [+m[1], +m[2], +m[3]]);

/** sRGB decoding (IEC 61966-2-1), WCAG 2.x relative luminance and contrast ratio */
const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (hex: string) => {
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a) + 0.05, lum(b) + 0.05]; return Math.max(x, y) / Math.min(x, y); };

describe('UI skins', () => {
  it('three skins, neutral is the default', () => {
    expect(THEMES.map(([t]) => t)).toEqual(['neutral', 'lzm', 'original']);
    expect(DEFAULT_THEME).toBe('neutral');
    expect(isTheme('lzm')).toBe(true);
    expect(isTheme('skin')).toBe(false);
  });

  it('neutral skin is achromatic apart from the status dots: R = G = B, so CIELAB a* = b* = 0 under D65', () => {
    const hx = hexes(neutralPart);
    expect(hx.length).toBeGreaterThan(10);
    for (const h of hx) expect(h.slice(0, 2) === h.slice(2, 4) && h.slice(2, 4) === h.slice(4, 6), `#${h}`).toBe(true);
    for (const [r, g, b] of rgbas(neutralPart)) expect(r === g && g === b, `rgba(${r},${g},${b})`).toBe(true);
    for (const h of hexes(Object.values(HUD_STYLE.neutral).join(' '))) expect(h.slice(0, 2) === h.slice(2, 4) && h.slice(2, 4) === h.slice(4, 6)).toBe(true);
  });

  it('neutral text contrast meets WCAG 2.x AA (4.5:1) on the cards', () => {
    // values from style.css: text #d6d6d6, secondary #a8a8a8, card #2e2e2e, ground #262626
    expect(contrast('d6d6d6', '2e2e2e')).toBeGreaterThan(9);
    expect(contrast('a8a8a8', '2e2e2e')).toBeGreaterThan(4.5);
    expect(contrast('a8a8a8', '262626')).toBeGreaterThan(4.5);
    expect(neutralPart).toContain('--text: #d6d6d6');
    expect(neutralPart).toContain('--muted: #a8a8a8');
    expect(neutralPart).toContain('--panel-2: #2e2e2e');
  });

  it('scope background is shared, not part of a skin', () => {
    expect((css.match(/--scope-bg:/g) ?? []).length).toBe(1);
  });
});
