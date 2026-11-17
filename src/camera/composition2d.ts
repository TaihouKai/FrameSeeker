// Liu, Chen, Wolf, Cohen-Or 2010, "Optimizing Photo Composition" (DESIGN.md §6.6): four composition scores on the
// picture plane — rule of thirds (points and lines), diagonal dominance, visual balance, region size — with the
// paper's constants. Pure and deterministic: regions and lines come from the projected 3D scene, not from image
// analysis (the paper detects them with saliency and line detection; we know them exactly).
//
// Coordinates are normalized to [0, 1] (u right, v down); distances use the paper's normalized Manhattan distance
// d_M = |Δu| + |Δv| (each axis already divided by the frame's width/height).

export interface Region2D { /** centre */ c: [number, number]; /** fraction of the frame it covers */ area: number; /** saliency in [0, 1] */ saliency: number }
export interface Line2D { a: [number, number]; b: [number, number]; /** saliency in [0, 1] */ saliency: number }
export interface Composition { E: number; RT: number; DA: number | null; VB: number; SZ: number }

// the paper's constants
export const SIGMA_POINT = 0.17, SIGMA_LINE = 0.17, SIGMA_BALANCE = 0.2;
export const GAMMA_POINT = 1 / 3, GAMMA_LINE = 2 / 3;
export const W_RT = 1, W_VB = 0.3, W_SZ = 0.08;
export const SIZE_PEAKS: [number, number][] = [[0.1, 0.07], [0.56, 0.2], [0.82, 0.16]];
/** a line within this angle of a frame diagonal counts as diagonal (degrees) */
export const DIAGONAL_TOLERANCE = 10;

const POWER_POINTS: [number, number][] = [[1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3]];
const dM = (p: [number, number], q: [number, number]) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
const gauss = (d: number, s: number) => Math.exp(-(d * d) / (2 * s));

/** Points along a segment (the paper's line distance averages over all its points). */
function samples(l: Line2D, n = 16): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => [l.a[0] + (l.b[0] - l.a[0]) * i / n, l.a[1] + (l.b[1] - l.a[1]) * i / n] as [number, number]);
}

/** Average distance from a segment's points to the closest points of the four third lines (min over the lines). */
export function thirdLineDistance(l: Line2D): number {
  const pts = samples(l);
  const toVertical = (x: number) => pts.reduce((s, p) => s + Math.abs(p[0] - x), 0) / pts.length;
  const toHorizontal = (y: number) => pts.reduce((s, p) => s + Math.abs(p[1] - y), 0) / pts.length;
  return Math.min(toVertical(1 / 3), toVertical(2 / 3), toHorizontal(1 / 3), toHorizontal(2 / 3));
}

/** Average distance from a segment's points to the nearer frame diagonal (closest point in normalized coordinates). */
export function diagonalDistance(l: Line2D): number {
  const pts = samples(l);
  // diagonal 1: v = u ; diagonal 2: v = 1 - u. Closest point under the Manhattan metric lies straight across one axis.
  const d1 = pts.reduce((s, p) => s + Math.abs(p[1] - p[0]), 0) / pts.length;
  const d2 = pts.reduce((s, p) => s + Math.abs(p[1] - (1 - p[0])), 0) / pts.length;
  return Math.min(d1, d2);
}

/** Whether a segment runs at a frame diagonal's angle (in pixels: the frame's aspect matters). */
export function isDiagonal(l: Line2D, aspect: number /* height / width */): boolean {
  const ang = (dx: number, dy: number) => { const a = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI); return a > 90 ? 180 - a : a; };
  const line = ang(l.b[0] - l.a[0], (l.b[1] - l.a[1]) * aspect);
  const diag = ang(1, aspect);
  return Math.abs(line - diag) <= DIAGONAL_TOLERANCE;
}

export function composition(regions: Region2D[], lines: Line2D[], aspect: number): Composition {
  const mass = (r: Region2D) => r.area * r.saliency;
  const total = regions.reduce((s, r) => s + mass(r), 0);
  // rule of thirds: subjects near the power points, prominent lines near the third lines
  const point = total > 0 ? regions.reduce((s, r) => s + mass(r) * gauss(Math.min(...POWER_POINTS.map((g) => dM(r.c, g))), SIGMA_POINT), 0) / total : 0;
  const straight = lines.filter((l) => !isDiagonal(l, aspect));
  const diagonal = lines.filter((l) => isDiagonal(l, aspect));
  const lineW = straight.reduce((s, l) => s + l.saliency, 0);
  const lineScore = lineW > 0 ? straight.reduce((s, l) => s + l.saliency * gauss(thirdLineDistance(l), SIGMA_LINE), 0) / lineW : null;
  const RT = lineScore === null ? point : GAMMA_POINT * point + GAMMA_LINE * lineScore;
  // diagonal dominance: diagonal lines lying along the frame's diagonals
  const diagW = diagonal.reduce((s, l) => s + l.saliency, 0);
  const DA = diagW > 0 ? diagonal.reduce((s, l) => s + l.saliency * gauss(diagonalDistance(l), SIGMA_LINE), 0) / diagW : null;
  // visual balance: the centre of visual mass near the frame centre
  const centre: [number, number] = total > 0 ? [regions.reduce((s, r) => s + mass(r) * r.c[0], 0) / total, regions.reduce((s, r) => s + mass(r) * r.c[1], 0) / total] : [0.5, 0.5];
  const VB = gauss(dM([0.5, 0.5], centre), SIGMA_BALANCE);
  // region size: sizes as in professional photographs (three peaks); averaged over regions to stay in [0, 1]
  const SZ = regions.length ? regions.reduce((s, r) => s + Math.max(...SIZE_PEAKS.map(([m, t]) => gauss(r.area - m, t))), 0) / regions.length : 0;
  const wDA = DA === null ? 0 : 1;
  const Ea = (W_RT * RT + wDA * (DA ?? 0) + W_VB * VB) / (W_RT + wDA + W_VB);
  return { E: (1 - W_SZ) * Ea + W_SZ * SZ, RT, DA, VB, SZ };
}
