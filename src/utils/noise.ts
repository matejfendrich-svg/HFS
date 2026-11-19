// Vrstvený value noise (fBm) nad deterministickým hashem + krajina 4×4 km:
// uhlazený reliéf, bezlesé plochy, řeka s přítokem a jezero (vykreslené vodní
// hladinou). Stejná analytická funkce slouží renderu i kolizím.

import { hash2, clamp, lerp, smoothstep } from './math';

export interface TerrainCfg {
  seed: number;
  octaves: number;
  baseFrequency: number;
  persistence: number;
  amplitude: number;
  ridgeBoost: number;
  baseLift: number;
  smoothRadius: number;
  clearings: { x: number; z: number; r: number; flat: number | null }[];
  water: {
    river: { zBase: number; amp1: number; f1: number; amp2: number; f2: number; width: number; depth: number };
    stream: { xBase: number; amp: number; f: number; width: number; depth: number; zFrom: number; zTo: number };
    lake: { x: number; z: number; r: number; depth: number };
    levelOffset: number;
  };
  waterLevel?: number; // dopočítá se při prvním volání
}

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

function fbm2(x: number, z: number, seed: number, octaves: number, persistence: number): number {
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

// surový reliéf (s mírným vyhlazením přes okolí) bez vodních erozí a ploch
function rawBase(x: number, z: number, cfg: TerrainCfg): number {
  const s = cfg.smoothRadius;
  const c = (xx: number, zz: number) => fbm2(xx * cfg.baseFrequency, zz * cfg.baseFrequency, cfg.seed, cfg.octaves, cfg.persistence);
  // mírné vyhlazení přes okolí (uhlazená krajina)
  let h = (c(x, z) * 2 + c(x + s, z) + c(x - s, z) + c(x, z + s) + c(x, z - s)) / 6;
  const ridge = 1 - Math.abs(valueNoise2(x * cfg.baseFrequency * 0.7 + 31.7, z * cfg.baseFrequency * 0.7 - 17.3, cfg.seed ^ 0x5f3759df));
  h = h * (1 - cfg.ridgeBoost) + ridge * cfg.ridgeBoost * Math.sign(h || 1);
  return h * cfg.amplitude + cfg.baseLift;
}

// křivka řeky: z jako funkce x
function riverZ(x: number, w: TerrainCfg['water']): number {
  return w.river.zBase + w.river.amp1 * Math.sin(x * w.river.f1) + w.river.amp2 * Math.sin(x * w.river.f2);
}

// hladina vody: minimum surového reliéfu podél celé řeky + offset (řeka teče údolím)
export function waterLevelOf(cfg: TerrainCfg): number {
  if (cfg.waterLevel === undefined) {
    let mn = Infinity;
    for (let i = 0; i <= 40; i++) {
      const x = -1900 + (3800 * i) / 40;
      mn = Math.min(mn, rawBase(x, riverZ(x, cfg.water), cfg));
    }
    cfg.waterLevel = mn + cfg.water.levelOffset;
  }
  return cfg.waterLevel;
}

// Výšková mapa světa v bodě (x, z) [m].
export function terrainHeight(x: number, z: number, cfg: TerrainCfg): number {
  const wl = waterLevelOf(cfg);
  let h = rawBase(x, z, cfg);
  // údolí nesmí klesnout pod hladinu (kromě vykreslených vodních toků)
  h = Math.max(h, wl + 0.8);
  const w = cfg.water;
  // jezero: miska pod hladinou
  const dl = Math.hypot(x - w.lake.x, z - w.lake.z);
  if (dl < w.lake.r * 1.8) {
    const t = smoothstep(w.lake.r * 1.8, w.lake.r * 0.75, dl);
    h = lerp(h, wl - w.lake.depth, t);
  }
  // řeka: koryto podél křivky (vzdálenost aproximována přes |z − riverZ(x)|)
  const dr = Math.abs(z - riverZ(x, w));
  if (dr < w.river.width * 2.4) {
    const t = smoothstep(w.river.width * 2.4, w.river.width * 0.45, dr);
    h = lerp(h, wl - w.river.depth, t);
  }
  // přítok z jezera k řece
  const st = w.stream;
  if (z > st.zFrom - 60 && z < st.zTo + 60) {
    const sx = st.xBase + st.amp * Math.sin(z * st.f);
    const ds = Math.abs(x - sx);
    if (ds < st.width * 2.4) {
      const t = smoothstep(st.width * 2.4, st.width * 0.5, ds);
      h = lerp(h, wl - st.depth, t);
    }
  }
  // bezlesé plochy: plynulé vyrovnání (heliport má pevnou výšku, ostatní výšku
  // ve středu, vždy nad vodní hladinou)
  for (const zn of cfg.clearings) {
    const d = Math.hypot(x - zn.x, z - zn.z);
    if (d < zn.r * 1.6) {
      const target = zn.flat !== null ? zn.flat : Math.max(rawBase(zn.x, zn.z, cfg), wl + 2);
      h = lerp(h, target, clamp(smoothstep(zn.r * 1.6, zn.r, d), 0, 1));
    }
  }
  return h;
}

// Sklon terénu (normála) — numerickou derivací; používá se pro barvy a kolize.
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
