// Testy kritérií myšího řízení (oddíl 6.7a–d): proporcionální mapování
// virtuální páky — 10 % vzdálenost = ~10 % maxima, 100 % = maximum.

import { describe, it, expect } from 'vitest';
import { mapStick } from '../src/helicopter/controls';
import { CONTROLS } from '../src/config';
import { DEG } from '../src/utils/math';

const base = { expo: 0, sensitivity: 1, invertY: false };

describe('myší řízení (6.7)', () => {
  it('a) 10 % vzdálenost myši → ~10 % maxima (při expo 0)', () => {
    const m = mapStick(0.1, 0, base);
    expect(m.x).toBeCloseTo(0.1, 6);
    const m2 = mapStick(0, 0.1, base);
    expect(m2.y).toBeCloseTo(0.1, 6);
  });

  it('b) 100 % vzdálenost → maximum náklonu', () => {
    const m = mapStick(1, -1, base);
    expect(m.x).toBeCloseTo(1, 6);
    expect(m.y).toBeCloseTo(-1, 6);
    // cílové úhly odpovídají maxPitch/maxRoll z configu
    expect(-m.y * CONTROLS.maxPitchDeg * DEG).toBeCloseTo(CONTROLS.maxPitchDeg * DEG, 6);
  });

  it('mrtvá zóna 3–5 % dává nulu, okraj plynulý', () => {
    expect(mapStick(0.03, 0, base).x).toBe(0);
    expect(mapStick(0.05, 0, base).x).toBeCloseTo(0.05, 6);
    expect(mapStick(-0.04, 0, base).x).toBe(0);
  });

  it('expo křivka zjemní střed a zachovává okraje', () => {
    const e = { ...base, expo: CONTROLS.expoDefault };
    const mid = mapStick(0.5, 0, e).x;
    expect(mid).toBeLessThan(0.5); // střed je měkčí
    expect(mid).toBeGreaterThan(0.2);
    expect(mapStick(1, 0, e).x).toBeCloseTo(1, 6);
  });

  it('citlivost násobí výchylku, invert Y převrací osu', () => {
    expect(mapStick(0.5, 0, { ...base, sensitivity: 2 }).x).toBeCloseTo(1, 6);
    expect(mapStick(0, 0.5, { ...base, invertY: true }).y).toBeCloseTo(-0.5, 6);
  });
});
