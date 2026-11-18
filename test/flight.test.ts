// Numerické testy letového modelu (oddíl 14): energie nesmí z uzavřené
// soustavy unikat (autorotace — rotor se při výpadku nesmí zastavit),
// studený start musí roztočit rotor na nominál a hover musí být stabilní.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { FlightModel, type FlightEnv, type FlightInput } from '../src/helicopter/flightModel';
import { HELI_TYPES, PHYSICS } from '../src/config';

const type = HELI_TYPES[0];

function flatEnv(groundY = 0, mode: FlightEnv['mode'] = 'manual'): FlightEnv {
  return {
    wind: new THREE.Vector3(0, 0, 0),
    heightAt: () => groundY,
    treesNear: () => [],
    time: 0,
    assist: false,
    mode,
    attachForce: new THREE.Vector3(0, 0, 0),
    loadMass: 0,
  };
}

function input(over: Partial<FlightInput> = {}): FlightInput {
  return {
    targetPitch: 0, targetRoll: 0, pedal: 0, collectiveRate: 0,
    engineStart: false, engineCut: false, ...over,
  };
}

const H = PHYSICS.dt;

function stepN(m: FlightModel, env: FlightEnv, n: number, inp: FlightInput): void {
  for (let i = 0; i < n; i++) {
    env.time += H;
    m.step(inp, env, H);
  }
}

describe('letový model', () => {
  let savedDrag: boolean;
  beforeEach(() => {
    savedDrag = PHYSICS.debugDisableDrag;
  });
  afterEach(() => {
    (PHYSICS as unknown as { debugDisableDrag: boolean }).debugDisableDrag = savedDrag;
  });

  it('studený start roztočí rotor na nominální otáčky (sekvence E)', () => {
    const m = new FlightModel(type);
    m.reset(0, 2.7, 0);
    const env = flatEnv();
    stepN(m, env, Math.ceil(1 / H), input({ engineStart: true })); // stisk E
    expect(m.engine).toBe('cranking');
    // celá sekvence: crank + ignition + spool
    stepN(m, env, Math.ceil((type.startSequence.crankS + type.startSequence.ignitionS + type.startSequence.spoolS + 6) / H), input());
    expect(m.engine).toBe('running');
    expect(m.telemetry.omegaFrac).toBeGreaterThan(0.95);
    expect(m.telemetry.omegaFrac).toBeLessThan(1.1);
  });

  it('hover: vzlet, stabilní visení, přistání — bez NaN a crashů', () => {
    const m = new FlightModel(type);
    m.reset(0, 2.7, 0);
    const env = flatEnv();
    stepN(m, env, Math.ceil(1 / H), input({ engineStart: true }));
    stepN(m, env, Math.ceil(25 / H), input()); // spool-up
    expect(m.engine).toBe('running');
    // kolektiv na hover hodnotu pozvolna (cca 0,58 — plný kolektiv by přetížil rotor)
    stepN(m, env, Math.ceil(1.05 / H), input({ collectiveRate: 1 }));
    stepN(m, env, Math.ceil(30 / H), input());
    expect(m.crashed).toBe(false);
    expect(Number.isFinite(m.pos.x + m.pos.y + m.pos.z + m.omega)).toBe(true);
    // po 30 s je ve vzduchu (visí nebo mírně stoupá podle přebytku vztlaku)
    expect(m.pos.y).toBeGreaterThan(1.0);
    expect(m.pos.y).toBeLessThan(2000);
    expect(m.telemetry.omegaFrac).toBeGreaterThan(0.88); // governor drží Ω
    // měkké přistání: stáhni kolektiv pozvolna a zapni Assist (změkčené přistání)
    env.assist = true;
    stepN(m, env, Math.ceil(10 / H), input({ collectiveRate: -1 }));
    stepN(m, env, Math.ceil(40 / H), input());
    expect(m.crashed).toBe(false);
    expect(m.telemetry.onGround).toBe(true);
  });

  it('autorotace: při výpadku motoru rotor nezastaví, klesání je řízené, energie se netvoří', () => {
    const m = new FlightModel(type);
    m.reset(0, 500, 0);
    const env = flatEnv(-1e6); // bez země — čistý let, měříme před „dopadem“
    // roztoč rotor, pak výpadek motoru; s dopřednou rychlostí 25 m/s a mírným klopením
    m.omega = m.omegaNom;
    m.engine = 'dead';
    m.collective = 0.45;
    m.vel.set(25, 0, 0);
    const e0 = m.energy();
    const inp = input({ targetPitch: -6 * Math.PI / 180 }); // udržuje dopřednou rychlost
    stepN(m, env, Math.ceil(60 / H), inp); // 60 s autorotace (odpor zapnutý = reálné podmínky)
    const e1 = m.energy();
    // žádná energie se nesmí vytvořit (numerická stabilita soustavy)
    expect(e1).toBeLessThanOrEqual(e0 * 1.001);
    expect(Number.isFinite(e1)).toBe(true);
    // rotor se nesmí zastavit — proudění zespodu ho pohání (5.3)
    expect(m.omega).toBeGreaterThan(m.omegaNom * 0.55);
    expect(m.omega).toBeLessThanOrEqual(m.omegaNom * 1.15);
    // klesání se ustálí v řízeném pásmu (cca 1500–2000 ft/min při dopředné rychlosti)
    expect(-m.vel.y).toBeGreaterThan(2);
    expect(-m.vel.y).toBeLessThan(30);
  });

  it('energie uzavřené soustavy (bez odporu): žádný drift mimo fyzikální propad proudění', () => {
    (PHYSICS as unknown as { debugDisableDrag: boolean }).debugDisableDrag = true;
    const m = new FlightModel(type);
    m.reset(0, 500, 0);
    const env = flatEnv();
    m.omega = m.omegaNom;
    m.engine = 'dead';
    m.collective = 0.2;
    const e0 = m.energy();
    stepN(m, env, Math.ceil(10 / H), input()); // krátké okno: pád ještě nezrychlil extrémně
    const e1 = m.energy();
    // bez disipace smí energii jen předávat mezi složkami — nesmí růst
    expect(e1).toBeLessThanOrEqual(e0 * 1.001);
    // a úbytek je fyzikální (indukovaný proud do vzduchu), ne numerický útlum
    expect(e1).toBeGreaterThan(e0 * 0.5);
  });

  it('výpadek testovací klávesou: T přepne running → dead', () => {
    const m = new FlightModel(type);
    m.reset(0, 2.7, 0);
    const env = flatEnv();
    stepN(m, env, Math.ceil(1 / H), input({ engineStart: true }));
    stepN(m, env, Math.ceil(25 / H), input());
    expect(m.engine).toBe('running');
    stepN(m, env, Math.ceil(1 / H), input({ engineCut: true }));
    expect(m.engine).toBe('dead');
  });

  it('stabilizovaný režim: při neutrální páce se vrtulník sám srovná do vodorovné polohy', () => {
    const m = new FlightModel(type);
    m.reset(0, 300, 0);
    const env = flatEnv(-1e6, 'stabilized');
    m.omega = m.omegaNom;
    m.engine = 'running';
    m.collective = 0.5;
    m.pitch = 20 * Math.PI / 180; // „rozhozený“ náklon
    m.roll = -15 * Math.PI / 180;
    stepN(m, env, Math.ceil(6 / H), input()); // bez vstupu
    expect(Math.abs(m.pitch)).toBeLessThan(3 * Math.PI / 180);
    expect(Math.abs(m.roll)).toBeLessThan(3 * Math.PI / 180);
  });

  it('hover režim: bez vstupu tlumí vodorovnou rychlost (držení pozice)', () => {
    const m = new FlightModel(type);
    m.reset(0, 300, 0);
    const env = flatEnv(-1e6, 'hover');
    m.omega = m.omegaNom;
    m.engine = 'running';
    m.collective = 0.5;
    m.vel.set(10, 0, 0);
    stepN(m, env, Math.ceil(8 / H), input());
    expect(Math.hypot(m.vel.x, m.vel.z)).toBeLessThan(3);
  });

  it('setrvačnost: bez vstupu vrtulník drží rychlost (žádné auto-brzdění)', () => {
    const m = new FlightModel(type);
    m.reset(0, 300, 0);
    const env = flatEnv();
    m.omega = m.omegaNom;
    m.engine = 'running';
    m.collective = 0.5;
    m.vel.set(20, 0, 0);
    m.pitch = -10 * Math.PI / 180; // mírně dolů = urychlení
    const v0 = m.vel.length();
    stepN(m, env, Math.ceil(5 / H), input({ collectiveRate: 0 }));
    // rychlost řádově drží (odpor jen mírně zpomalí), nesmí spadnout k nule
    expect(m.vel.length()).toBeGreaterThan(v0 * 0.7);
  });
});
