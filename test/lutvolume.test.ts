import { describe, expect, it } from 'vitest';
import { lutVolume } from '../src/cube';
import { validateCommand } from '../server/control.mjs';

describe('LUT volume', () => {
  it('n³ lattice over 0…1 with the LUT output per point (identity: output = input, ×0.5: halved)', () => {
    const id = lutVolume((c) => c, 5);
    expect(id).toHaveLength(125);
    expect(id[0].inp).toEqual([0, 0, 0]); expect(id[124].inp).toEqual([1, 1, 1]);
    id.forEach((p) => expect(p.out).toEqual(p.inp));
    const half = lutVolume((c) => c.map((v) => v / 2), 3);
    expect(half[26].out).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('control API: qc.clear', () => {
  it('is a valid command without options', () => {
    expect(validateCommand({ cmd: 'qc.clear' }).ok).toBe(true);
  });
});
