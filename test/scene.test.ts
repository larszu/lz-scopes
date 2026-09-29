import { describe, expect, it } from 'vitest';
import {
  MAX_ELEMENTS, MIN_SIZE, defaultScene, dragElement, findScene, hitTest, newElement, parseScenes, sanitizeScene, sanitizeScenes, serializeScenes,
  type OverlayScene,
} from '../src/scene';

const scene = (): OverlayScene => ({
  id: 'a1', name: 'Studio',
  elements: [
    { id: 'e1', scope: 'wf-luma', x: 0.05, y: 0.6, w: 0.6, h: 0.35, opacity: 0.8, dim: 0.5, src: '' },
    { id: 'e2', scope: 'vector', x: 0.7, y: 0.5, w: 0.25, h: 0.45, opacity: 1, dim: 0, src: 's2' },
  ],
});

describe('scene serialisation', () => {
  it('round trip keeps everything', () => {
    const s = [scene(), defaultScene('Zweite')];
    expect(parseScenes(serializeScenes(s))).toEqual(s);
  });

  it('never returns an empty list', () => {
    expect(sanitizeScenes(null)).toHaveLength(1);
    expect(sanitizeScenes([])).toHaveLength(1);
    expect(parseScenes('not json')).toHaveLength(1);
    expect(sanitizeScenes(null)[0].elements[0].scope).toBe('wf-luma');
  });

  it('drops broken scenes and elements, clamps values', () => {
    const s = sanitizeScene({
      id: 'x', name: '  Wand  ', elements: [
        { scope: 'picture', x: 0, y: 0, w: 1, h: 1 },          // not an overlay scope
        { scope: 'hist', x: -1, y: 2, w: 5, h: 0.001, opacity: 3, dim: -1, src: 7 },
        'garbage',
      ],
    })!;
    expect(s.name).toBe('Wand');
    expect(s.elements).toHaveLength(1);
    const e = s.elements[0];
    expect(e).toMatchObject({ scope: 'hist', x: 0, w: 1, h: MIN_SIZE, opacity: 1, dim: 0, src: '' });
    expect(e.y).toBeCloseTo(1 - MIN_SIZE, 6);
    expect(e.id).toBeTruthy();
    expect(sanitizeScene({ name: '', elements: [] })).toBeNull();
    expect(sanitizeScene({ name: 'x' })).toBeNull();
  });

  it('fills missing numbers from the defaults and limits the element count', () => {
    const s = sanitizeScene({ name: 'Viele', elements: Array.from({ length: 40 }, () => ({ scope: 'cie' })) })!;
    expect(s.elements).toHaveLength(MAX_ELEMENTS);
    expect(s.elements[0]).toMatchObject({ opacity: 1, w: newElement('cie').w });
  });

  it('makes duplicate ids unique', () => {
    const list = sanitizeScenes([scene(), scene()]);
    expect(list[0].id).not.toBe(list[1].id);
  });

  it('finds scenes by id, name or number', () => {
    const list = [scene(), defaultScene('Zweite')];
    expect(findScene(list, 'a1')?.name).toBe('Studio');
    expect(findScene(list, 'studio')?.id).toBe('a1');
    expect(findScene(list, 2)?.name).toBe('Zweite');
    expect(findScene(list, 3)).toBeNull();
    expect(findScene(list, 'nix')).toBeNull();
  });
});

describe('editing', () => {
  const tol: [number, number] = [0.01, 0.01];
  it('hit test: handles, body, topmost first, miss', () => {
    const els = scene().elements;
    expect(hitTest(els, 0.3, 0.75, tol)).toEqual({ index: 0, handle: 'move' });
    expect(hitTest(els, 0.05, 0.6, tol)).toEqual({ index: 0, handle: 'nw' });
    expect(hitTest(els, 0.65, 0.95, tol)).toEqual({ index: 0, handle: 'se' });
    expect(hitTest(els, 0.3, 0.6, tol)).toEqual({ index: 0, handle: 'n' });
    expect(hitTest(els, 0.95, 0.7, tol)).toEqual({ index: 1, handle: 'e' });
    expect(hitTest(els, 0.5, 0.1, tol)).toBeNull();
    // overlap: the later element is on top
    const over = [els[0], { ...els[1], x: 0.2, y: 0.6 }];
    expect(hitTest(over, 0.3, 0.75, tol)?.index).toBe(1);
  });

  it('move stays inside the picture', () => {
    const e = scene().elements[0];
    expect(dragElement(e, 'move', 0.1, -0.1)).toMatchObject({ x: 0.15, y: 0.5, w: 0.6, h: 0.35 });
    const far = dragElement(e, 'move', 2, 2);
    expect(far.x).toBeCloseTo(0.4, 6); expect(far.y).toBeCloseTo(0.65, 6);
  });

  it('resize from each side, keeps the opposite edge, minimum size', () => {
    const e = scene().elements[0];
    const se = dragElement(e, 'se', 0.1, 0.02);
    expect(se.x).toBe(e.x); expect(se.w).toBeCloseTo(0.7, 6); expect(se.h).toBeCloseTo(0.37, 6);
    const nw = dragElement(e, 'nw', 0.05, 0.1);
    expect(nw.x + nw.w).toBeCloseTo(e.x + e.w, 6); expect(nw.y + nw.h).toBeCloseTo(e.y + e.h, 6);
    const tiny = dragElement(e, 'w', 5, 0);
    expect(tiny.w).toBeCloseTo(MIN_SIZE, 6); expect(tiny.x + tiny.w).toBeCloseTo(e.x + e.w, 6);
    const big = dragElement(e, 's', 0, 5);
    expect(big.y + big.h).toBeCloseTo(1, 6);
  });
});
