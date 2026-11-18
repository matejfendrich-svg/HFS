// Pomocné matematické funkce (jednotky SI, úhly v radiánech).

export const DEG = Math.PI / 180;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Exponenciální křivka citlivosti (oddíl 6.1): out = sign(in)·|in|^(1+expo·curve)
export function expoCurve(v: number, expo: number, curve: number): number {
  const a = Math.abs(v);
  return Math.sign(v) * Math.pow(a, 1 + expo * curve);
}

// Mrtvá zóna bez přepočtu zbytku rozsahu: aby kritérium 6.7a platilo přesně
// (10 % vzdálenost myši = ~10 % maxima při expo 0), nesmí se zbytek škálovat.
export function deadZone(v: number, dz: number): number {
  return Math.abs(v) <= dz ? 0 : v;
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(target, current, Math.exp(-lambda * dt));
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// Deterministický PRNG (mulberry32) — svět musí být reprodukovatelný podle seed.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(ix: number, iz: number, seed: number): number {
  let h = seed ^ Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
