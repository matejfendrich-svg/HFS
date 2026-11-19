// ============================================================================
// Naviják, lano a hák (oddíl 7) — vlastní Verletův řešič s distančním
// omezením (PBD s inverzními hmotnostmi). Horní konec lana je vždy přesně na
// závěsném bodu vrtulníku, spodní na háku/kmenu (7.1). Lano nesmí projít
// terénem ani kmenem (7.2). Při překročení ~2× nosnosti háku dynamickým
// rázem se lano přetrhne (7.2) — klidné oznámení, kmen lze zvednout znovu.
// ============================================================================

import * as THREE from 'three';
import { ROPE, PHYSICS } from '../config';
import { clamp, lerp } from '../utils/math';
import type { Log } from '../world/logs';

export interface RopeEnv {
  heightAt: (x: number, z: number) => number;
  logCollide: (p: THREE.Vector3, out: THREE.Vector3, skip: Log | null) => boolean;
  // rotorové proudění: přídavné zrychlení lana v bodě p (směřuje dolů pod rotorem)
  downwashAt: (p: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3;
}

export class RopeSim {
  points: THREE.Vector3[] = [];
  prev: THREE.Vector3[] = [];
  vel: THREE.Vector3[] = [];      // odhad rychlosti bodu (pro odpor vzduchu)
  velPrev: THREE.Vector3[] = [];  // předchozí rychlost (pro odhad zrychlení/rázu)
  invMass: number[] = [];
  length: number = ROPE.minLength; // délka lana podle navijáku [m]
  attached: Log | null = null;
  broken = false;
  breakReason = '';
  tension = 0;                    // napětí [N] (klouzavý průměr — kvůli kmitání)
  tensionPeak = 0;                // špička napětí pro detekci rázu (přetržení)
  winchRate = 0;                  // kladné = vysouvání [m/s]
  hookMaxLoad: number;
  private segLen = 0.5;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(hookMaxLoad: number) {
    this.hookMaxLoad = hookMaxLoad;
    this.reset(new THREE.Vector3(0, 0, 0));
  }

  reset(attach: THREE.Vector3): void {
    const n = ROPE.points;
    this.points = [];
    this.prev = [];
    this.vel = [];
    this.velPrev = [];
    this.invMass = [];
    this.length = ROPE.minLength;
    this.segLen = this.length / (n - 1);
    for (let i = 0; i < n; i++) {
      const p = attach.clone();
      p.y -= this.segLen * i * (1 - ROPE.sagInit * Math.sin((Math.PI * i) / (n - 1)));
      this.points.push(p);
      this.prev.push(p.clone());
      this.vel.push(new THREE.Vector3());
      this.velPrev.push(new THREE.Vector3());
      this.invMass.push(1 / (ROPE.massPerMeter * this.segLen));
    }
    this.broken = false;
    this.tension = 0;
  }

  get hookPos(): THREE.Vector3 {
    return this.points[this.points.length - 1];
  }

  // Naviják: R vysouvá, V zatahuje, rychlost 2 m/s, min 3 m / max 40 m (7.2).
  setLength(winchInput: number, dt: number): void {
    if (this.broken) { this.winchRate = 0; return; }
    this.winchRate = winchInput * ROPE.winchSpeed;
    const oldSeg = this.segLen;
    this.length = clamp(this.length + this.winchRate * dt, ROPE.minLength, ROPE.maxLength);
    this.segLen = this.length / (this.points.length - 1);
    if (Math.abs(this.segLen - oldSeg) > 1e-7) {
      // body přerozdělíme podél původního lana (naviják lano "pohltí"/vysune)
      const top = this.points[0];
      const bottom = this.points[this.points.length - 1];
      for (let i = 1; i < this.points.length; i++) {
        const t = i / (this.points.length - 1);
        const target = top.clone().lerp(bottom, t);
        this.points[i].lerp(target, clamp((this.segLen - oldSeg) * 6, 0, 1));
      }
    }
  }

  attachLoad(log: Log): void {
    this.attached = log;
    log.attached = true;
    const last = this.invMass.length - 1;
    this.invMass[last] = 1 / (ROPE.massPerMeter * this.segLen + log.mass);
  }

  detachLoad(): Log | null {
    const l = this.attached;
    if (l) {
      l.attached = false;
      const last = this.invMass.length - 1;
      this.invMass[last] = 1 / (ROPE.massPerMeter * this.segLen);
    }
    this.attached = null;
    return l;
  }

  breakRope(reason: string): void {
    if (this.broken) return;
    this.broken = true;
    this.breakReason = reason;
    this.detachLoad();
  }

  // Hlavní krok na fixním kroku 1/120 s.
  step(dt: number, attachWorld: THREE.Vector3, env: RopeEnv): void {
    const n = this.points.length;
    const dt2 = dt * dt;
    // horní konec přesně na závěsném bodu trupu (7.1)
    this.points[0].copy(attachWorld);
    this.prev[0].copy(attachWorld);
    this.vel[0].set(0, 0, 0);
    this.velPrev[0].set(0, 0, 0);

    // --- Verlet integrace ---
    for (let i = 1; i < n; i++) {
      const p = this.points[i];
      const pv = this.prev[i];
      // zavěšený těžký náklad dostane větší tlumení, aby lano nekmitlo
      const damp = i === n - 1 && this.attached ? 0.9 : ROPE.damping;
      const vx = (p.x - pv.x) * damp;
      const vy = (p.y - pv.y) * damp;
      const vz = (p.z - pv.z) * damp;
      this.velPrev[i].copy(this.vel[i]);
      this.vel[i].set(vx / dt, vy / dt, vz / dt);
      pv.copy(p);
      // tíha působí jako zrychlení na každý bod; hmotnost nákladu vstupuje
      // přes inverzní hmotnosti v omezeních (PBD) — kyvadlo vzniká samo (7.3)
      const a = this.tmpA.set(0, -PHYSICS.gravity, 0);
      env.downwashAt(p, this.tmpB);
      a.add(this.tmpB);
      // odpor vzduchu lana proti jeho rychlosti (+ malý odpor nákladu)
      const dragK = i === n - 1 && this.attached ? ROPE.airDrag * 6 : ROPE.airDrag * 0.05;
      a.addScaledVector(this.vel[i], -dragK);
      p.x += vx + a.x * dt2;
      p.y += vy + a.y * dt2;
      p.z += vz + a.z * dt2;
    }

    // --- distanční omezení, 4–8 iterací (7.2) ---
    // korekce prvního segmentu přímo dává tah v laně: F = m·Δp/dt²
    const corr1 = new THREE.Vector3();
    for (let iter = 0; iter < ROPE.iterations; iter++) {
      this.points[0].copy(attachWorld);
      for (let i = 0; i < n - 1; i++) {
        const a = this.points[i];
        const b = this.points[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - this.segLen) / d;
        const wa = i === 0 ? 0 : this.invMass[i]; // horní bod je připíchnutý k závěsu
        const wb = this.invMass[i + 1];
        const wSum = wa + wb || 1e-9;
        a.x += dx * diff * (wa / wSum); a.y += dy * diff * (wa / wSum); a.z += dz * diff * (wa / wSum);
        const cbx = dx * diff * (wb / wSum), cby = dy * diff * (wb / wSum), cbz = dz * diff * (wb / wSum);
        b.x -= cbx; b.y -= cby; b.z -= cbz;
        if (i === 0) corr1.set(cbx, cby, cbz);
      }
      // kolize s terénem: lano nesmí pod zem (7.2)
      for (let i = 1; i < n; i++) {
        const p = this.points[i];
        const h = env.heightAt(p.x, p.z) + 0.08;
        if (p.y < h) {
          p.y = h;
          this.prev[i].x = p.x + (p.x - this.prev[i].x) * 0.55; // tření o zem
          this.prev[i].z = p.z + (p.z - this.prev[i].z) * 0.55;
        }
        if (env.logCollide(p, this.tmpA, this.attached)) {
          p.copy(this.tmpA);
        }
      }
      // dalekodosahové omezení: hák nesmí být dál od závěsu než délka lana
      // (jinak těžký náklad "propadne" dolů a lano se nekonečně natahuje)
      const a0 = this.points[0];
      const bLast = this.points[n - 1];
      const dTop = a0.distanceTo(bLast);
      if (dTop > this.segLen * (n - 1)) {
        const dirx = (bLast.x - a0.x) / (dTop || 1e-6);
        const diry = (bLast.y - a0.y) / (dTop || 1e-6);
        const dirz = (bLast.z - a0.z) / (dTop || 1e-6);
        const over = dTop - this.segLen * (n - 1);
        bLast.x -= dirx * over;
        bLast.y -= diry * over;
        bLast.z -= dirz * over;
      }
    }

    // --- napětí lana: statická tíha zavěšené soustavy pod bodem 0 + dynamický ráz ---
    // (v PBD s tíhou jako zrychlením korekce prvního segmentu neodpovídají fyzikálnímu
    // tahu — proto se tah počítá z bilance sil; viz DECISIONS.md)
    const p0 = this.points[0];
    const p1 = this.points[1];
    const dir = this.tmpA.copy(p1).sub(p0);
    const dl = dir.length() || 1e-6;
    dir.divideScalar(dl); // d̂: od závěsu dolů
    let mBelow = 0;
    for (let i = 1; i < n; i++) mBelow += 1 / this.invMass[i];
    const last = n - 1;
    const acc = this.tmpB.copy(this.vel[last]).sub(this.velPrev[last]).divideScalar(dt);
    const staticT = (mBelow * PHYSICS.gravity) / Math.max(-dir.y, 0.2); // úhel lana od svislice
    // elastický ráz: hák dál od závěsu než délka lana (škubnutí hákem)
    const stretch = Math.max(0, this.points[0].distanceTo(this.points[n - 1]) - this.segLen * (n - 1));
    const instant = Math.max(0, staticT + stretch * mBelow * PHYSICS.gravity + mBelow * acc.length() * 0.5);
    this.tension = lerp(this.tension, instant, 0.05); // klouzavý průměr
    this.tensionPeak = Math.max(this.tensionPeak * 0.99, instant); // špička s rychlejším úbytkem
    // přetržení při dynamickém rázu nad breakTensionFactor × nosnost háku (7.2)
    const breakN = ROPE.breakTensionFactor * this.hookMaxLoad * PHYSICS.gravity;
    if (!this.broken && this.tensionPeak > breakN) {
      this.breakRope('přetržení lana — dynamický ráz přes 2× nosnost háku');
    }
    void corr1;
  }

  // Síla lana na závěsný bod vrtulníku (7.6): táhne trup směrem k nákladu,
  // vytváří moment → kyvadlová dynamika nákladu ovlivňuje let.
  attachForceOnHeli(out: THREE.Vector3): THREE.Vector3 {
    if (this.broken || this.points.length < 2) return out.set(0, 0, 0);
    const dir = out.copy(this.points[1]).sub(this.points[0]);
    if (dir.lengthSq() < 1e-9) return out.set(0, 0, 0);
    dir.normalize();
    return out.multiplyScalar(this.tension);
  }
}
