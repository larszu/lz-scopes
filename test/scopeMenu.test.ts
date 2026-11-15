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

import { diamondPoint, diamondZoomView, vectorCentreBox } from '../src/graticule';
import { viewClip } from '../src/view';

describe('diamond magnifier and vector centre box (feedback 11/2026)', () => {
  it('black point sits in the middle at ×4', () => {
    const v = diamondZoomView('black')!;
    expect(viewClip(v, 0, 0)).toEqual([0, 0]);
  });
  it('white apexes stay on screen when magnified', () => {
    for (const z of ['whiteB', 'whiteR'] as const) {
      const v = diamondZoomView(z)!, py = z === 'whiteB' ? 0.92 : -0.92;
      const [, y] = viewClip(v, 0, py);
      expect(Math.abs(y)).toBeLessThan(1);
    }
    expect(diamondZoomView('full')).toBeUndefined();
  });
  it('the centre box does not depend on the gain', () => {
    expect(vectorCentreBox(200)).toBeCloseTo(200 * 0.036);
    // sanity: diamond geometry unchanged
    const r = { x: 0, y: 0, w: 100, h: 200 };
    expect(diamondPoint(r, 0, 0, true)).toEqual([50, 100]);
  });
});
