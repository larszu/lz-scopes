import { describe, expect, it } from 'vitest';
import { SCOPE_GROUPS, SCOPE_LABELS, parseScopeMenu, scopeMenu, scopeMenuValue, type ScopeType } from '../src/graticule';

describe('scope menu in groups (feedback 11/2026)', () => {
  it('every scope sits in exactly one group', () => {
    const all = SCOPE_GROUPS.flatMap(([, l]) => l);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(Object.keys(SCOPE_LABELS).sort());
  });

  it('false colour, zebra and focus peaking are entries of their own under the picture', () => {
    const [, pic] = scopeMenu()[0];
    const values = pic.map(([v]) => v);
    expect(values).toEqual(expect.arrayContaining(['picture', 'picture:false', 'picture:zebra', 'picture:peaking']));
  });

  it('menu value and panel state round-trip', () => {
    expect(scopeMenuValue('picture', 'false')).toBe('picture:false');
    expect(scopeMenuValue('picture', 'normal')).toBe('picture');
    expect(scopeMenuValue('parade' as ScopeType, 'false')).toBe('parade');
    expect(parseScopeMenu('picture:zebra')).toEqual({ scope: 'picture', picture: 'zebra' });
    expect(parseScopeMenu('picture')).toEqual({ scope: 'picture', picture: 'normal' });
    expect(parseScopeMenu('diamond')).toEqual({ scope: 'diamond' });
  });

  it('the embed menu can leave scopes and the picture entries out', () => {
    const vals = scopeMenu((s) => s === 'stats', false).flatMap(([, o]) => o.map(([v]) => v));
    expect(vals).not.toContain('stats');
    expect(vals.some((v) => v.startsWith('picture:'))).toBe(false);
  });
});

import { diamondPoint, diamondScale, diamondZoomView, vectorCentreBox } from '../src/graticule';
import { viewClip } from '../src/view';

describe('diamond magnifier and vector centre box (feedback 11/2026)', () => {
  it('black point sits in the middle at ×4', () => {
    const v = diamondZoomView('black', { w: 400, h: 600 })!;
    expect(viewClip(v, 0, 0)).toEqual([0, 0]);
  });
  it('white apexes stay on screen when magnified', () => {
    for (const z of ['whiteB', 'whiteR'] as const) {
      const r = { w: 400, h: 600 }, v = diamondZoomView(z, r)!, py = (z === 'whiteB' ? 2 : -2) * diamondScale(r).sy;
      const [, y] = viewClip(v, 0, py);
      expect(Math.abs(y)).toBeLessThan(1);
    }
    expect(diamondZoomView('full', { w: 400, h: 600 })).toBeUndefined();
  });
  it('the centre box does not depend on the gain', () => {
    expect(vectorCentreBox(200)).toBeCloseTo(200 * 0.036);
    // sanity: diamond geometry unchanged
    const r = { x: 0, y: 0, w: 100, h: 200 };
    expect(diamondPoint(r, 0, 0, true)).toEqual([50, 100]);
  });
  it('split diamond: black ends apart, diamonds stay squares inside the panel (#248)', () => {
    const r = { x: 0, y: 0, w: 300, h: 300 };
    const [, yu] = diamondPoint(r, 0, 0, true, 0.3), [, yl] = diamondPoint(r, 0, 0, false, 0.3);
    expect(yl - yu).toBeGreaterThan(5);
    const [, top] = diamondPoint(r, 1, 1, true, 0.3), [, bottom] = diamondPoint(r, 1, 1, false, 0.3);
    expect(top).toBeGreaterThanOrEqual(0); expect(bottom).toBeLessThanOrEqual(300);
    const [bx, by] = diamondPoint(r, 1, 0, true, 0.3);
    expect(Math.abs(bx - 150)).toBeCloseTo(Math.abs(by - yu), 6);
  });
});
