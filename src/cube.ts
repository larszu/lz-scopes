// 3D colour volume (issue #8): every sampled pixel as a point in the R′G′B′ cube, in CIELAB or
// in ICtCp, rotatable, with the target gamut as a wire frame. Idea from colour-repos.md (DCTLs
// "Map_to_3D_Cube", prism LUT volume view – GPL resp. MIT, only the idea); own code. The shader
// (renderer.ts, mode 9) and the CPU functions below use the same axes and scales:
//   R′G′B′: x = R′, y = G′, z = B′, centred on 50 %;
//   CIELAB: x = a*, y = L* (up), z = b*, D65 white of the source = L* 100;
//   ICtCp : x = CT, y = I (up), z = CP, from BT.2020 display light (1.0 = 203 cd/m² for HDR,
//           100 cd/m² for SDR) – BT.2100 ICtCp as in color.ts rgb2020ToIctcp.

import { GAMUTS, gamutConvert, mul3, rgb2020ToIctcp, rgbToXyzMatrix, signalToLinear, xyzToLab, type GamutId, type Transfer } from './color';

export type CubeSpace = 'rgb' | 'lab' | 'ictcp';
export const CUBE_SPACE_ID: Record<CubeSpace, number> = { rgb: 0, lab: 1, ictcp: 2 };
export const CUBE_SPACE_LABELS: Record<CubeSpace, string> = { rgb: 'R′G′B′-Würfel', lab: 'CIELAB', ictcp: 'ICtCp' };

export interface CubeSettings { space: CubeSpace; yaw: number; pitch: number; gamut: '709' | 'p3' | '2020' }
export const DEFAULT_CUBE: CubeSettings = { space: 'rgb', yaw: 35, pitch: 25, gamut: '709' };

/** Projection scale into clip space (fits the rotated cube corners). */
export const CUBE_SCALE = 0.55;

/** Row-major rotation: first yaw about the vertical axis, then pitch about the horizontal one (degrees). */
export function cubeRotation(yawDeg: number, pitchDeg: number): number[] {
  const y = (yawDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
  // Rx(p) · Ry(y)
  return [cy, 0, sy, sp * sy, cp, -sp * cy, -cp * sy, sp, cp * cy];
}

export const qFromRgb = (rgb: number[]) => rgb.map((v) => (v - 0.5) * 1.6);
export const qFromLab = (lab: number[]) => [(lab[1] / 128) * 1.2, (lab[0] / 100 - 0.5) * 2, (lab[2] / 128) * 1.2];
export const qFromIctcp = (ic: number[]) => [ic[1] * 3, (ic[0] - 0.3) * 2.4, ic[2] * 3];

/** Clip-space x, y of a volume point after the rotation (orthographic). */
export function cubeProject(rot: number[], q: number[]): [number, number] {
  const v = mul3(rot, q);
  return [v[0] * CUBE_SCALE, v[1] * CUBE_SCALE];
}

/** Cube edges as corner-index pairs (corner i = bits R, G, B). */
const EDGES: [number, number][] = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
const corner = (i: number) => [i & 1, (i >> 1) & 1, (i >> 2) & 1];

/**
 * Wire frame polylines (volume coordinates q) of the target: in R′G′B′ the 0–100 % cube, in
 * CIELAB / ICtCp the edges of the target gamut's linear RGB cube (0…1 = up to reference white),
 * seen from a source with primaries `srcGamut` (its white is the Lab reference).
 */
export function cubeWireframe(space: CubeSpace, target: GamutId, srcGamut: GamutId, nits = 100, steps = 24): number[][][] {
  return EDGES.map(([a, b]) => {
    const ca = corner(a), cb = corner(b), line: number[][] = [];
    for (let i = 0; i <= (space === 'rgb' ? 1 : steps); i++) {
      const t = space === 'rgb' ? i : i / steps;
      const c = ca.map((v, k) => v + (cb[k] - v) * t);
      if (space === 'rgb') line.push(qFromRgb(c));
      else if (space === 'lab') {
        const M = rgbToXyzMatrix(GAMUTS[target]), W = mul3(rgbToXyzMatrix(GAMUTS[srcGamut]), [1, 1, 1]);
        line.push(qFromLab(xyzToLab(mul3(M, c), W)));
      } else {
        const m = gamutConvert(GAMUTS[target], GAMUTS['2020']);
        line.push(qFromIctcp(rgb2020ToIctcp(mul3(m, c).map((v) => Math.max(0, v) * nits))));
      }
    }
    return line;
  });
}

/** GLSL for plotSample mode 9 (needs toLinear, uToXYZ of the scatter shader). */
export const CUBE_GLSL = `
uniform int uCube; uniform mat3 uRot, uTo2020; uniform vec3 uWhiteXYZ; uniform float uCubeNits;
float labF(float t) { return t > 216.0 / 24389.0 ? pow(t, 1.0 / 3.0) : (24389.0 / 27.0 * t + 16.0) / 116.0; }
float pqE(float n) { float p = pow(max(n, 0.0) / 10000.0, 0.1593017578125); return pow((0.8359375 + 18.8515625 * p) / (1.0 + 18.6875 * p), 78.84375); }
vec3 cubeQ(vec3 rgb) {
  if (uCube == 0) return (rgb - 0.5) * 1.6;
  vec3 lin = toLinear(rgb);
  if (uCube == 1) {
    vec3 xyz = uToXYZ * lin / uWhiteXYZ;
    vec3 f = vec3(labF(xyz.x), labF(xyz.y), labF(xyz.z));
    vec3 lab = vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
    return vec3(lab.y / 128.0 * 1.2, (lab.x / 100.0 - 0.5) * 2.0, lab.z / 128.0 * 1.2);
  }
  vec3 n = max(uTo2020 * lin, 0.0) * uCubeNits;
  vec3 lms = vec3(pqE(dot(n, vec3(1688.0, 2146.0, 262.0) / 4096.0)), pqE(dot(n, vec3(683.0, 2951.0, 462.0) / 4096.0)), pqE(dot(n, vec3(99.0, 309.0, 3688.0) / 4096.0)));
  vec3 ic = vec3(dot(lms, vec3(2048.0, 2048.0, 0.0)), dot(lms, vec3(6610.0, -13613.0, 7003.0)), dot(lms, vec3(17933.0, -17390.0, -543.0))) / 4096.0;
  return vec3(ic.y * 3.0, (ic.x - 0.3) * 2.4, ic.z * 3.0);
}`;

/** cd/m² of linear 1.0 for the ICtCp axis: HDR reference white 203 (BT.2408), SDR 100. */
export const cubeNits = (t: Transfer) => (t === 'pq' || t === 'hlg' ? 203 : 100);

/** Volume coordinates of one signal R′G′B′ (CPU mirror of cubeQ in the shader). */
export function cubeQOf(space: CubeSpace, rgb: number[], s: { transfer: Transfer; gamut: GamutId; hlgLw: number }): number[] {
  if (space === 'rgb') return qFromRgb(rgb);
  const lin = signalToLinear(rgb, s.transfer, s.hlgLw);
  if (space === 'lab') {
    const M = rgbToXyzMatrix(GAMUTS[s.gamut]);
    return qFromLab(xyzToLab(mul3(M, lin), mul3(M, [1, 1, 1])));
  }
  const m = gamutConvert(GAMUTS[s.gamut], GAMUTS['2020']);
  return qFromIctcp(rgb2020ToIctcp(mul3(m, lin).map((v) => Math.max(0, v) * cubeNits(s.transfer))));
}
