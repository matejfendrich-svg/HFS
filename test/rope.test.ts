// Testy lana (oddíl 7): oba konce ukotveny, segmenty ned exceedují délku,
// lano nesmí pod terén, napětí při zavěšeném nákladu ≈ tíha nákladu.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RopeSim, type RopeEnv } from '../src/rope/ropeSim';
import { ROPE, PHYSICS } from '../src/config';
import type { Log } from '../src/world/logs';

const H = PHYSICS.dt;

function env(groundY = -100): RopeEnv {
  return {
    heightAt: () => groundY,
    logCollide: () => false,
    downwashAt: (_p, out) => out.set(0, 0, 0),
  };
}

function fakeLog(mass: number): Log {
  return {
    id: 0, pos: new THREE.Vector3(), yaw: 0, length: 8, diameter: 0.6, mass,
    delivered: false, attached: false, fallen: false,
    group: new THREE.Group(), bodyMesh: new THREE.Mesh(),
    markColor: new THREE.Color(), attachPoint: () => new THREE.Vector3(),
  };
}

describe('lano (Verlet)', () => {
  it('horní konec přesně sleduje závěsný bod, délka segmentů je zachována', () => {
    const rope = new RopeSim(8000);
    const attach = new THREE.Vector3(10, 50, -5);
    rope.reset(attach);
    const e = env();
    for (let i = 0; i < 240; i++) {
      attach.x += 0.01; // závěs se pohybuje — lano ho musí sledovat
      rope.step(H, attach, e);
    }
    expect(rope.points[0].distanceTo(attach)).toBeLessThan(1e-9);
    for (let i = 0; i < rope.points.length - 1; i++) {
      const d = rope.points[i].distanceTo(rope.points[i + 1]);
      // PBD může segment mírně natáhnout při pohybu závěsu — tolerance 6 %
      expect(d).toBeLessThanOrEqual((rope.length / (ROPE.points - 1)) * 1.06);
    }
  });

  it('lano nesmí projít terénem', () => {
    const rope = new RopeSim(8000);
    rope.reset(new THREE.Vector3(0, 8, 0));
    rope.length = ROPE.maxLength; // dlouhé lano k zemi
    const e = env(0); // zem v y=0
    for (let i = 0; i < 600; i++) rope.step(H, new THREE.Vector3(0, 8, 0), e);
    for (const p of rope.points) expect(p.y).toBeGreaterThanOrEqual(0.07);
  });

  it('zavěšený náklad: napětí ≈ tíha kmene, hák visí pod závěsem', () => {
    const rope = new RopeSim(8000);
    rope.reset(new THREE.Vector3(0, 30, 0));
    const e = env();
    rope.attachLoad(fakeLog(2000));
    for (let i = 0; i < 1200; i++) rope.step(H, new THREE.Vector3(0, 30, 0), e);
    const expected = 2000 * PHYSICS.gravity;
    expect(rope.tension).toBeGreaterThan(expected * 0.8);
    expect(rope.tension).toBeLessThan(expected * 1.3);
    expect(rope.hookPos.y).toBeLessThan(30 - rope.length * 0.8);
  });

  it('přetržení při rázu nad 2× nosnost háku', () => {
    const rope = new RopeSim(8000);
    rope.reset(new THREE.Vector3(0, 30, 0));
    const e = env();
    rope.attachLoad(fakeLog(3000));
    // prudký trh: závěs prudce nahoru
    for (let i = 0; i < 30; i++) rope.step(H, new THREE.Vector3(0, 30 + i * 2, 0), e);
    expect(rope.broken).toBe(true);
    expect(rope.attached).toBeNull();
  });
});
