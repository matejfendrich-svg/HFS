// ============================================================================
// Letový model vrtulníku (oddíl 5 zadání).
// Zjednodušená teorie momentu (indukovaná rychlost z T = 2ρA·u·|V_inflow|)
// doplněná o prvky BEMT (profilový výkon listů). Rotor + drak + energie:
//   E = ½mv² + mgh + ½IΩ²   (oddíl 5.3) — žádný externí fyzikální engine.
// Jednotky SI. Fixní krok 1/120 s se předpokládá (oddíl 6.7d).
// Konvence: stavové úhly jsou Euler YXZ — pitch > 0 = příď nahoru,
// roll > 0 = náklon doleva (three.js R_z). Vstupní targetRoll z myši je
// "náklon doprava kladný" a převádí se zde.
// ============================================================================

import * as THREE from 'three';
import { PHYSICS, ALT_HOLD, GAMEPLAY, type HeliTypeConfig, type FlightMode } from '../config';
import { clamp, lerp, smoothstep, wrapAngle, DEG } from '../utils/math';
import type { TreeInstance } from '../world/terrain';

export type EngineState = 'off' | 'cranking' | 'lightoff' | 'spoolup' | 'running' | 'dead';

export interface FlightInput {
  targetPitch: number;   // rad, kladné = příď nahoru (cílový náklon z myši)
  targetRoll: number;    // rad, kladné = náklon DOPRAVA (bank right)
  pedal: number;         // -1..1, +1 = zatáčení doleva (A)
  collectiveRate: number;// -1..1 (W/S), 0 = držet kolektiv
  engineStart: boolean;  // stisk E (start sekvence / vypnutí)
  engineCut: boolean;    // testovací výpadek motoru (klávesa T)
}

export interface FlightEnv {
  wind: THREE.Vector3;
  heightAt: (x: number, z: number) => number;
  treesNear: (x: number, z: number, r: number) => TreeInstance[];
  time: number;             // herní čas [s] (turbulence)
  mode: FlightMode;         // letový režim (jen tlumení; řídicí vrstva je vždy stejná, 5.4)
  turbulenceScale: number;  // 0 = bez větru (vůbec se neklepe), 1 = normál, >1 bouřka (17.3)
  attachForce: THREE.Vector3; // síla lana na závěsný bod (world) — nastaví ropeSim
  loadMass: number;         // hmotnost nákladu [kg] (0 = bez nákladu)
}

export interface FlightTelemetry {
  thrustN: number;
  powerKw: number;
  inducedMs: number;
  agl: number;             // výška těžiště nad terénem
  hubAgl: number;
  airspeed: number;
  horizSpeed: number;
  sinkRate: number;        // záporné = klesání podél osy disku
  groundEffect: number;
  etl: number;
  vrs: boolean;
  vrsFactor: number;
  omegaFrac: number;
  rotorLow: boolean;
  retreating: boolean;
  onGround: boolean;
  altHold: boolean;
  targetVy: number;
  energy: number;
  totalMass: number;
  weightN: number;
}

export class FlightModel {
  readonly type: HeliTypeConfig;
  // --- stav ---
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;                 // Euler, + = příď nahoru
  roll = 0;                  // Euler, + = náklon doleva
  yawRate = 0;
  pitchRate = 0;
  rollRate = 0;
  omega = 0;                 // rad/s hlavního rotoru
  collective = 0;            // 0..1
  targetVy = 0;              // cílová vertikální rychlost [m/s] (W/S příkaz, 6.3)
  altHold = false;           // držení výšky aktivní (6.3b, HUD ikonka)
  pedal = 0;                 // aktuální pedál (vyhlazený)
  fuelKg: number;
  engine: EngineState = 'off';
  engineTimer = 0;
  engineHealth = 1;          // 1 = oba motory OK (test výpadku = 0)
  crashed = false;
  crashReason = '';
  diskPitch = 0;             // sklon rotorového disku (s malým zpožděním za trupem)
  diskRoll = 0;
  attachForce = new THREE.Vector3();
  private prevEnginePower = 0;
  private pEngineSmooth = 0;    // změkčený výkon motoru přes první řád (governor lagS)
  telemetry: FlightTelemetry = {
    thrustN: 0, powerKw: 0, inducedMs: 0, agl: 0, hubAgl: 0, airspeed: 0, horizSpeed: 0,
    sinkRate: 0, groundEffect: 1, etl: 1, vrs: false, vrsFactor: 1, omegaFrac: 0,
    rotorLow: false, retreating: false, onGround: false, energy: 0, totalMass: 0, weightN: 0,
    altHold: false, targetVy: 0,
  };

  private readonly q = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();

  constructor(type: HeliTypeConfig) {
    this.type = type;
    this.fuelKg = type.fuelMax;
  }

  get omegaNom(): number {
    return (this.type.rotorRpmNom * 2 * Math.PI) / 60;
  }

  get rotorRadius(): number {
    return this.type.rotorDiameter / 2;
  }

  get rotorArea(): number {
    return Math.PI * this.rotorRadius * this.rotorRadius;
  }

  get totalMass(): number {
    return this.type.massEmpty + this.fuelKg + (this._envLoadMass || 0);
  }

  private _envLoadMass = 0;

  quaternion(): THREE.Quaternion {
    // YXZ: yaw kolem Y, pitch kolem X, roll kolem Z
    return this.q.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quaternion());
  }

  up(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.quaternion());
  }

  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.quaternion());
  }

  hubPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos).addScaledVector(this.up(this.tmpV), this.type.hubHeight);
  }

  // Závěsný bod lana pod trupem (oddíl 7.1) — vždy pevně svázaný s trupem.
  attachPos(out: THREE.Vector3): THREE.Vector3 {
    this.tmpV.set(0, this.type.attachOffsetY, 0).applyQuaternion(this.quaternion());
    return out.copy(this.pos).add(this.tmpV);
  }

  diskNormal(out: THREE.Vector3): THREE.Vector3 {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.diskPitch, this.yaw, this.diskRoll, 'YXZ'));
    return out.set(0, 1, 0).applyQuaternion(q);
  }

  energy(): number {
    const m = this.totalMass;
    return 0.5 * m * this.vel.lengthSq() + m * PHYSICS.gravity * this.pos.y + 0.5 * this.type.rotorInertia * this.omega * this.omega;
  }

  reset(x: number, y: number, z: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.yawRate = 0; this.pitchRate = 0; this.rollRate = 0;
    this.omega = 0;
    this.collective = 0;
    this.targetVy = 0;
    this.altHold = false;
    this.pEngineSmooth = 0;
    this.fuelKg = this.type.fuelMax;
    this.engine = 'off';
    this.engineTimer = 0;
    this.engineHealth = 1;
    this.crashed = false;
    this.crashReason = '';
    this.diskPitch = 0;
    this.diskRoll = 0;
    this.attachForce.set(0, 0, 0);
    this.prevEnginePower = 0;
  }

  // Hlavní krok — volá se na fixním kroku 1/120 s.
  step(input: FlightInput, env: FlightEnv, dt: number): void {
    const t = this.type;
    const P = PHYSICS;
    this._envLoadMass = env.loadMass;
    this.attachForce.copy(env.attachForce);
    const m = this.totalMass;
    const g = P.gravity;
    const rho = P.airDensity;
    const omegaNom = this.omegaNom;

    // --- 1. motor / startér sekvence (studený start, oddíl 8.1) ---
    this.engineTimer += dt;
    if (input.engineCut && this.engine === 'running') {
      this.engine = 'dead';
      this.engineTimer = 0;
    }
    if (input.engineStart) {
      if (this.engine === 'off') { this.engine = 'cranking'; this.engineTimer = 0; }
      else if (this.engine === 'running') { this.engine = 'off'; this.engineTimer = 0; }
    }
    const seq = t.startSequence;
    if (this.engine === 'cranking') {
      const target = omegaNom * 0.08;
      this.omega += (target - this.omega) * clamp(dt / 0.6, 0, 1);
      if (this.engineTimer >= seq.crankS) { this.engine = 'lightoff'; this.engineTimer = 0; }
    } else if (this.engine === 'lightoff') {
      if (this.engineTimer >= seq.ignitionS) { this.engine = 'spoolup'; this.engineTimer = 0; }
    } else if (this.engine === 'spoolup') {
      if (this.engineTimer >= seq.spoolS || this.omega > omegaNom * 0.995) this.engine = 'running';
    }
    const engineRunning = this.engine === 'running' || this.engine === 'spoolup';
    const fuelOk = this.fuelKg > 0;
    if (engineRunning && !fuelOk) this.engine = 'dead'; // vysazení při vyschnutí nádrže

    // --- 2. měkký kolektiv s držením výšky (oddíl 6, body 3 a 3b) ---
    // W/S (nebo kolečko) = příkaz VERTIKÁLNÍ RYCHLOSTI, náběh plynulý (vyRamp);
    // po puštění drží stroj výšku: cílová vy klesá měkce k 0. Samotný kolektiv
    // přestavuje až níže uzavřený regulátor přes vertikální zrychlení (níže).
    const AH = ALT_HOLD;
    if (input.collectiveRate !== 0) {
      this.targetVy = clamp(this.targetVy + input.collectiveRate * AH.vyRamp * dt, AH.sinkMax, AH.climbMax);
      this.altHold = false;
    } else if (engineRunning) {
      this.altHold = true; // držení výšky (HUD ikonka)
      this.targetVy = lerp(0, this.targetVy, Math.exp(-AH.holdDecay * dt));
    } else {
      this.altHold = false; // motor neběží — pilot řídí přes cílovou vy (autorotace)
    }

    // --- 3. orientace a rotorový disk ---
    this.quaternion();
    const hub = this.hubPos(new THREE.Vector3());
    // disk sleduje trup s malým zpožděním (cyklika má setrvačnost)
    const diskLag = 1 - Math.exp(-dt / 0.25);
    this.diskPitch += (this.pitch - this.diskPitch) * diskLag;
    this.diskRoll += (this.roll - this.diskRoll) * diskLag;
    const n = this.diskNormal(new THREE.Vector3());

    // --- 4. vzduch, rychlosti ---
    const vAir = this.tmpV.copy(this.vel).sub(env.wind);
    const V = vAir.length();
    const Vh = Math.hypot(vAir.x, vAir.z);
    const Vn = vAir.dot(n); // kladné = stoupání podél osy disku

    // --- 5. vztlak rotoru: T = C_T·ρ·A·(ΩR)² (oddíl 5.1) ---
    const cT = P.cTMax * Math.pow(this.collective, P.cTExponent);
    const tip = this.omega * this.rotorRadius;
    let T = cT * rho * this.rotorArea * tip * tip;

    // přízemní efekt (5.2)
    const hubAgl = hub.y - env.heightAt(hub.x, hub.z);
    const ge = 1 + P.groundEffect.maxBoost * Math.exp(-hubAgl / (P.groundEffect.heightScale * t.rotorDiameter));
    // translační vztlak ETL (5.2)
    const etl = 1 + P.etl.maxBoost * smoothstep(P.etl.start, P.etl.full, Vh) * (1 - smoothstep(P.etl.fadeStart, P.etl.fadeFull, Vh));
    // vírový kruh (5.2)
    const descent = -Vn; // kladné = sestup podél osy disku
    const weight = m * g;
    let vrsFactor = 1;
    const vrsActive = descent > P.vortexRing.descentStart && Vh < P.vortexRing.minHorizSpeed && T > P.vortexRing.minThrustFrac * weight;
    if (vrsActive) vrsFactor = lerp(1, P.vortexRing.minFactor, smoothstep(P.vortexRing.descentStart, P.vortexRing.descentFull, descent));
    T = T * ge * etl * vrsFactor;

    // --- 2b. uzavřený měkký regulátor kolektivu přes vertikální zrychlení (6.3/3b) ---
    // Zvednutí nákladu nezpůsobí skok — regulátor doladí kolektiv plynule přes aZ.
    const aZ = (T * n.y - weight) / m;
    const aDes = clamp((this.targetVy - this.vel.y) * AH.kADes, -AH.aDesMax, AH.aDesMax);
    let colErr = (aDes - aZ) * AH.kAColl;
    if (this.telemetry.onGround && this.targetVy <= 0) colErr = Math.min(colErr, -0.02); // na zemi jen klesat
    this.collective = clamp(this.collective + clamp(colErr, -AH.maxCollRate, AH.maxCollRate) * dt, 0, 1);

    // --- 6. indukovaná rychlost (teorie momentu) + výkon rotoru ---
    // T = 2ρA·u·sqrt(Vh² + (u+Vn)²). V čistém svislém sestupu existují dvě
    // větve řešení: běžná (u>0, vírový kruh) a větrná — windmill (u<0), kdy
    // proudění zespodu pohání rotor (autorotace, oddíl 5.3). Při Vh>0 se
    // řeší iterací z kladného semene.
    const k = T / (2 * rho * this.rotorArea);
    let u: number;
    if (Vh < 1.0) {
      // uzavřené řešení osové úlohy u² + Vn·u − k = 0
      const disc = Math.sqrt(Vn * Vn + 4 * Math.max(k, 0));
      const uHover = Math.sqrt(Math.max(k, 0));
      if (Vn < -2 * uHover) u = (-Vn - disc) / 2; // větrná větev (u < 0)
      else u = (-Vn + disc) / 2;                // běžná větev (u ≥ 0)
    } else {
      u = Math.sqrt(Math.max(k, 0));
      for (let i = 0; i < P.inducedSolveIterations; i++) {
        const inflow = Math.sqrt(Vh * Vh + (u + Vn) * (u + Vn));
        const uNext = inflow > 1e-6 ? k / inflow : 0;
        u = lerp(u, uNext, 0.7);
      }
    }
    u = clamp(u, -40, 40);
    const pInduced = T * (Vn + u); // může být záporné v autorotaci → rotor poháněn vzduchem
    // profilový výkon listů (BEMT) — v ladicím režimu vypnut spolu s odporem draku
    const pProfile = P.debugDisableDrag ? 0 : 0.125 * rho * this.rotorArea * tip * tip * tip * t.solidity * t.profilePowerCd;
    const pRotor = pInduced + pProfile;

    // --- 7. governor + energie rotoru: dΩ = (P_in − P_out)/(I·Ω) (5.3) ---
    const pMax = t.engines * t.enginePowerKw * 1000 * this.engineHealth;
    let pEngine = 0;
    if (this.engine === 'running') {
      pEngine = clamp(pRotor + P.governor.gain * (omegaNom - this.omega), 0, pMax);
    } else if (this.engine === 'spoolup') {
      const ramp = clamp(this.engineTimer / seq.spoolS, 0, 1);
      pEngine = clamp(Math.max(pRotor + P.governor.gain * (omegaNom - this.omega), pMax * ramp * 0.5), 0, pMax * Math.max(ramp, 0.35));
    }
    // změkčený governor: výkon motoru přes první řád s prodlevou lagS → hladké Ω (17.7)
    this.pEngineSmooth = lerp(this.pEngineSmooth, pEngine, 1 - Math.exp(-dt / P.governor.lagS));
    if (this.engine !== 'cranking' && this.engine !== 'lightoff') {
      const dOmega = (this.pEngineSmooth - pRotor) / (t.rotorInertia * Math.max(this.omega, 0.5)) * dt;
      this.omega = clamp(this.omega + dOmega, 0, omegaNom * 1.12);
    }
    const dPowerDt = (pEngine - this.prevEnginePower) / dt;
    this.prevEnginePower = pEngine;

    // spotřeba paliva (oddíl 5.1)
    const flow = P.fuel.minFlowKgS + P.fuel.kgPerKwPerS * (pEngine / 1000);
    if (engineRunning) this.fuelKg = Math.max(0, this.fuelKg - flow * dt);

    // --- 8. síly na drak ---
    const F = this.tmpV2.set(0, -weight, 0);
    F.addScaledVector(n, T);
    if (!P.debugDisableDrag) {
      const cdA = t.dragCdA + (env.loadMass > 0 ? t.loadDragCdA : 0);
      F.addScaledVector(vAir, -0.5 * rho * cdA * V); // D = ½ρv²C_D·A ve směru −v
    }
    // stabilizované režimy (DJI-like / arkádově „zbržděné“): lineární útlum rychlosti
    // vodorovně i svisle — stroj se po puštění páky rychle zastaví, ale reálné rychlosti
    // zůstávají zachované (jen tlumení, žádné omezení maxima)
    const horizDamp = env.mode === 'stabilized' ? GAMEPLAY.stabilized.horizDamp : 0;
    const vertDamp = env.mode === 'stabilized' ? GAMEPLAY.stabilized.vertDamp : 0;
    if (horizDamp > 0) {
      F.x -= this.vel.x * m * horizDamp;
      F.z -= this.vel.z * m * horizDamp;
    }
    if (vertDamp > 0) {
      F.y -= this.vel.y * m * vertDamp;
    }
    // ocasní rotor: příčná síla + kompenzace reaktivního momentu (5.1)
    const right = this.right(new THREE.Vector3());
    const tailForce = this.pedal * 15000;
    F.addScaledVector(right, tailForce);
    F.add(this.attachForce); // lano na závěsném bodě (7.6)
    // turbulence (5.4 revidováno + 17.3): jen nízkofrekvenční drift, jen ve větru —
    // bez větru (turbulenceScale = 0) se vrtulník vůbec neklepe
    const ti = P.turbulence_intensity * env.turbulenceScale;
    if (ti > 0) {
      const w = 2 * Math.PI * P.turbulence_freq;
      const tSec = env.time;
      const aAmp = ti * P.turbulence_maxDeltaV * w;
      F.x += m * aAmp * Math.cos(w * tSec);
      F.z += m * aAmp * Math.sin(w * tSec * 0.83 + 1.7);
    }
    this.vel.addScaledVector(F, dt / m);
    this.pos.addScaledVector(this.vel, dt);

    // --- 9. úhlová dynamika: cyklika = P·chyba − D·rychlost (6.2) ---
    const A = P.attitude;
    // ústup listu snižuje dostupné pásmo cykliky (5.2)
    const retreating = V > P.retreatingStall.start;
    const authority = 1 - P.retreatingStall.maxAuthorityLoss * smoothstep(P.retreatingStall.start, P.retreatingStall.full, V);
    let tgtPitch = clamp(input.targetPitch, -A.maxPitchDeg * DEG, A.maxPitchDeg * DEG) * authority;
    let tgtRollE = clamp(-input.targetRoll, -A.maxRollDeg * DEG, A.maxRollDeg * DEG) * authority; // euler roll: + vlevo
    // POZNÁMKA (6.7c): žádný auto-level — po puštění myši drží vrtulník ustálený náklon.
    // Režimy mění jen tlumení (stabilizovaný = „přibitější“, jak požadoval zadavatel).
    // vyšší tlumení náklonu ve stabilizovaných režimech (méně „klepání“, rychlejší odezva)
    const kD = A.kD * (env.mode === 'manual' ? 1 : GAMEPLAY.stabilized.kDMultiplier);
    const kP = A.kP * (env.mode === 'manual' ? 1 : GAMEPLAY.stabilized.kPMultiplier);
    // vnější moment od lana na závěsném bodě (7.6) — kyvadlový efekt nákladu
    const rAttach = new THREE.Vector3(0, t.attachOffsetY, 0).applyQuaternion(this.quaternion());
    const M = new THREE.Vector3().crossVectors(rAttach, this.attachForce);
    const Mbody = M.applyQuaternion(this.q.clone().invert());
    let pitchAcc = kP * wrapAngle(tgtPitch - this.pitch) - kD * this.pitchRate + Mbody.x / t.inertia.x;
    let rollAcc = kP * wrapAngle(tgtRollE - this.roll) - kD * this.rollRate + Mbody.z / t.inertia.z;
    this.pitchRate = clamp(this.pitchRate + pitchAcc * dt, -A.maxPitchRateDegS * DEG, A.maxPitchRateDegS * DEG);
    this.rollRate = clamp(this.rollRate + rollAcc * dt, -A.maxRollRateDegS * DEG, A.maxRollRateDegS * DEG);
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -A.maxPitchDeg * DEG, A.maxPitchDeg * DEG);
    this.roll = clamp(this.roll + this.rollRate * dt, -A.maxRollDeg * DEG, A.maxRollDeg * DEG);
    // pedály: cílová úhlová rychlost + reakce na změnu výkonu (5.1)
    const yawTarget = input.pedal * A.maxYawRateDegS * DEG;
    this.pedal = lerp(this.pedal, input.pedal, clamp(dt * 10, 0, 1));
    const yawAcc = (yawTarget - this.yawRate) * 8 - A.reactionTorqueCoupling * dPowerDt;
    this.yawRate = clamp(this.yawRate + yawAcc * dt, -A.maxYawRateDegS * DEG, A.maxYawRateDegS * DEG);
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

    // --- 10. kolize (oddíl 4.6) ---
    this.collide(env, dt);

    // --- 11. telemetrie ---
    const agl = this.pos.y - env.heightAt(this.pos.x, this.pos.z);
    const tel = this.telemetry;
    tel.thrustN = T;
    tel.powerKw = pEngine / 1000;
    tel.inducedMs = u;
    tel.agl = agl;
    tel.hubAgl = hubAgl;
    tel.airspeed = V;
    tel.horizSpeed = Vh;
    tel.sinkRate = -Vn;
    tel.groundEffect = ge;
    tel.etl = etl;
    tel.vrs = vrsActive;
    tel.vrsFactor = vrsFactor;
    tel.omegaFrac = this.omega / omegaNom;
    tel.rotorLow = this.omega < omegaNom * P.rotorMinFrac && this.engine !== 'off';
    tel.retreating = retreating;
    tel.altHold = this.altHold;
    tel.targetVy = this.targetVy;
    tel.energy = this.energy();
    tel.totalMass = m;
    tel.weightN = weight;
  }

  private collide(env: FlightEnv, dt: number): void {
    const t = this.type;
    const P = PHYSICS;
    // terén pod trupem (koule kolem těžiště + spodní část trupu)
    const h = env.heightAt(this.pos.x, this.pos.z);
    const bottomOffset = 2.7; // nejnižší bod trupu/podvozku pod těžištěm
    // přistání bez „polštářového“ odpružení (oddíl 2): jen odraz a tření
    let onGround = false;
    if (this.pos.y - bottomOffset < h) {
      const impact = -this.vel.y;
      this.pos.y = h + bottomOffset;
      if (impact > P.crash.maxSinkRate) {
        this.crashed = true;
        this.crashReason = 'tvrdý náraz na zem (příliš vysoká rychlost sestupu)';
        // náraz spotřebuje energii — rychlost se při tvrdém dopadu ztratí
        this.vel.y = 0;
        this.vel.x *= 0.3;
        this.vel.z *= 0.3;
      } else {
        if (this.vel.y < 0) this.vel.y = -this.vel.y * P.crash.restitution;
        if (Math.abs(this.vel.y) < 1.2) this.vel.y = 0;
        this.vel.x *= P.crash.groundFriction;
        this.vel.z *= P.crash.groundFriction;
        onGround = true;
      }
    }
    // rotorový disk vs terén a stromy
    const hub = this.hubPos(new THREE.Vector3());
    const q = this.quaternion();
    const R = this.rotorRadius * 0.92;
    const samples = 8;
    let strike = false;
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2 + this.yaw;
      const p = new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R).applyQuaternion(q).add(hub);
      const th = env.heightAt(p.x, p.z);
      if (p.y < th + 0.4) strike = true;
      for (const tr of env.treesNear(p.x, p.z, 3)) {
        const gy = env.heightAt(tr.x, tr.z);
        const d2 = Math.hypot(p.x - tr.x, p.z - tr.z);
        if (d2 < tr.radius + 1.6 && p.y < tr.topY && p.y > gy + 1) strike = true;
      }
    }
    if (strike) {
      if (this.omega > this.omegaNom * P.crash.rotorStrikeOmegaFrac) {
        this.crashed = true;
        this.crashReason = 'střet rotorového disku s terénem/stromem';
      } else {
        this.pos.y += 0.5;
        this.vel.y = Math.max(this.vel.y, 0.5);
      }
    }
    // trup vs kmeny stromů (kuželová kolize kmene, oddíl 4.2)
    for (const tr of env.treesNear(this.pos.x, this.pos.z, t.gearRadius + 4)) {
      const gy = env.heightAt(tr.x, tr.z);
      const d2 = Math.hypot(this.pos.x - tr.x, this.pos.z - tr.z);
      if (d2 < tr.radius + t.gearRadius * 0.9 && this.pos.y < tr.topY && this.pos.y > gy) {
        const dir = this.tmpV.set(this.pos.x - tr.x, 0, this.pos.z - tr.z).normalize();
        this.pos.addScaledVector(dir, tr.radius + t.gearRadius * 0.9 - d2);
        const vn = this.vel.dot(dir);
        if (vn < 0) this.vel.addScaledVector(dir, -vn * 1.3);
        if (this.vel.length() > 14) {
          this.crashed = true;
          this.crashReason = 'střet trupu se stromem';
        }
      }
    }
    this.telemetry.onGround = onGround;
    void dt;
  }
}

