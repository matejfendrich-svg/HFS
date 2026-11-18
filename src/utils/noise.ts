// Vrstvený value noise (fBm) nad deterministickým hashem — výšková mapa terénu
// i další procedurální věci. Stejná funkce se používá pro render i kolize.

import { hash2, clamp, lerp, smoothstep } from './math';

function valueNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = smoothstep(0, 1, fx);
  const uz = smoothstep(0, 1, fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz) * 2 - 1; // -> [-1, 1]
}

export function fbm2(x: number, z: number, seed: number, octaves: number, persistence: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, z * freq, seed + i * 101);
    norm += amp;
    amp *= persistence;
    freq *= 2.03;
  }
  return sum / norm; // -> [-1, 1]
}

// Výšková mapa světa: kombinace fBm + mírného hřebenového reliéfu.
// Vrací výšku terénu v bodě (x, z) v metrech. 0 = střed světa, výška 0.
export function terrainHeight(x: number, z: number, cfg: {
  seed: number; octaves: number; baseFrequency: number; persistence: number; amplitude: number; ridgeBoost: number;
}): number {
  const nx = x * cfg.baseFrequency;
  const nz = z * cfg.baseFrequency;
  let h = fbm2(nx, nz, cfg.seed, cfg.octaves, cfg.persistence);
  // hřeben: |noise| dává ostré hřbety
  const ridge = 1 - Math.abs(valueNoise2(nx * 0.7 + 31.7, nz * 0.7 - 17.3, cfg.seed ^ 0x5f3759df));
  h = h * (1 - cfg.ridgeBoost) + ridge * cfg.ridgeBoost * Math.sign(h || 1);
  const raw = h * cfg.amplitude;
  // heliport a plochy musí být rovné — plynulé vyhlazení kolem clearings
  // (cílová výška plochy = surová výška terénu ve středu plochy, heliport = 0)
  const zones: { x: number; z: number; r: number; flat: number | null }[] = [
    { x: 0, z: 0, r: 60, flat: 0 },
    { x: 520, z: -430, r: 80, flat: null },
    { x: -560, z: 380, r: 95, flat: null },
  ];
  let height = raw;
  for (const zn of zones) {
    const d = Math.hypot(x - zn.x, z - zn.z);
    if (d < zn.r * 1.6) {
      const target = zn.flat !== null ? zn.flat : rawAt(zn.x, zn.z);
      const t = smoothstep(zn.r * 1.6, zn.r, d);
      height = lerp(target, height, clamp(t, 0, 1));
    }
  }
  return height;

  function rawAt(cx: number, cz: number): number {
    const n1 = fbm2(cx * cfg.baseFrequency, cz * cfg.baseFrequency, cfg.seed, cfg.octaves, cfg.persistence);
    const ridge = 1 - Math.abs(valueNoise2(cx * cfg.baseFrequency * 0.7 + 31.7, cz * cfg.baseFrequency * 0.7 - 17.3, cfg.seed ^ 0x5f3759df));
    const hh = n1 * (1 - cfg.ridgeBoost) + ridge * cfg.ridgeBoost * Math.sign(n1 || 1);
    return hh * cfg.amplitude;
  }
}

// Sklon terénu (normála) — numerickou derivací, používá se pro barvy a kolize.
export function terrainNormal(
  x: number, z: number,
  heightFn: (x: number, z: number) => number,
): { nx: number; ny: number; nz: number; slope: number } {
  const e = 2.0;
  const hL = heightFn(x - e, z);
  const hR = heightFn(x + e, z);
  const hD = heightFn(x, z - e);
  const hU = heightFn(x, z + e);
  const nx = (hL - hR) / (2 * e);
  const nz = (hD - hU) / (2 * e);
  const inv = 1 / Math.hypot(nx, 1, nz);
  const slope = Math.hypot(nx, nz);
  return { nx: nx * inv, ny: inv, nz: nz * inv, slope };
}
