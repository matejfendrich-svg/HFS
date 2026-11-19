// ============================================================================
// Herní smyčka (oddíl 8): směna = 8–12 kmenů z těžební oblasti na odkládací
// plochu. Bez časovačů a trestů — hodnocení formou přátelských „pilotních
// poznámek“ s odměnou (duch Rotor City). Peníze se ukládají (localStorage),
// později půjde obchod (oddíl 13).
// ============================================================================

import * as THREE from 'three';
import { MISSION, WORLD, ROPE } from '../config';
import type { FlightModel } from '../helicopter/flightModel';
import type { RopeSim } from '../rope/ropeSim';
import type { Log, LogField } from '../world/logs';

export interface RadioMessage {
  text: string;
  at: number; // herní čas
}

export interface ShiftReport {
  shift: number;
  delivered: number;
  total: number;
  crosses: number;          // 1–3
  moneyEarned: number;
  notes: string[];          // pilotní poznámky
  smoothness: number;       // 0..1
  accuracy: number;         // 0..1
  safety: number;           // 0..1
}

export type MissionState = 'flying' | 'report';

const DISPATCH_LINES = {
  start: [
    'Dobrý večer, veliteli. Směna začíná — studený start přes E.',
    'Klidný večer na horách. První kmen čeká v těžební oblasti na západě.',
    'Rotor Logger na frekvenci. Věž přeji pěknou směnu.',
  ],
  pickupReady: [
    'Hák je nad značkou — mezerník zajistí chycení.',
    'Vidím tě pod sebou. Klidně, přesně, mezerník.',
  ],
  attached: [
    'Máme ho! Kmen visí — hlídej kyvadlo při akceleraci.',
    'Zachyceno. S takovou zátěží přidej kolektiv, ať neosedneš.',
  ],
  delivered: [
    'Pěkně odloženo do kruhu. Další kmen na řadě.',
    'Jedna kláda doma. Plynulá práce, veliteli.',
  ],
  droppedOutside: [
    'Kmen zůstal mimo plochu — žádný stres, můžeš ho zvednout znovu.',
    'Mimo kruh, ale nic se nestalo. Vezmi ho znovu, až budeš chtít.',
  ],
  ropeBroken: [
    'Lano se přetrhlo při rázu — kmen zůstal na místě, zkus to klidněji.',
  ],
  crash: [
    'Nouzové přistání na heliportu. Stroj je znovu připraven.',
  ],
  shiftDone: [
    'Všechny kmeny jsou doma — podívej se na pilotní poznámky (Enter).',
  ],
};

export class Mission {
  state: MissionState = 'flying';
  shift = 1;
  money = 0;
  deliveredCount = 0;
  radio: RadioMessage[] = [];
  report: ShiftReport | null = null;
  pickupCandidate: Log | null = null;
  // metriky pro hodnocení
  private swingAccum = 0;
  private minAglCarry = Infinity;
  private releaseDists: number[] = [];
  private time = 0;

  constructor() {
    this.loadSave();
  }

  loadSave(): void {
    try {
      const raw = localStorage.getItem(MISSION.saveKey);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.money === 'number') this.money = s.money;
        if (typeof s.shift === 'number' && s.shift > 0) this.shift = s.shift;
      }
    } catch { /* ignorovat */ }
  }

  save(): void {
    try {
      localStorage.setItem(MISSION.saveKey, JSON.stringify({ money: Math.round(this.money), shift: this.shift }));
    } catch { /* ignorovat */ }
  }

  say(text: string): void {
    this.radio.push({ text, at: this.time });
    if (this.radio.length > 5) this.radio.shift();
  }

  private pick(lines: string[]): string {
    return lines[Math.floor(Math.random() * lines.length)];
  }

  startShift(logField: LogField, rngSeedShift: number): void {
    void rngSeedShift;
    logField.spawnShift(this.shift);
    this.state = 'flying';
    this.deliveredCount = 0;
    this.report = null;
    this.swingAccum = 0;
    this.minAglCarry = Infinity;
    this.releaseDists = [];
    this.say(this.pick(DISPATCH_LINES.start));
    this.say(`Směna č. ${this.shift}: převeď ${logField.pendingCount()} kmenů na odkládací plochu (vlaječka na východě).`);
  }

  nextShift(logField: LogField): void {
    this.shift += 1;
    this.save();
    this.startShift(logField, this.shift);
  }

  // --- hlavní update ---
  update(dt: number, heli: FlightModel, rope: RopeSim, logField: LogField): void {
    this.time += dt;
    this.pickupCandidate = null;
    if (this.state !== 'flying') return;

    // kandidát na chycení (7.3): hák do 1,5 m od paty kmene a přibližně pod vrtulníkem
    const hook = rope.hookPos;
    if (!rope.attached && !rope.broken) {
      for (const log of logField.logs) {
        if (log.delivered || log.attached) continue;
        const ap = log.attachPoint();
        const d = hook.distanceTo(ap);
        if (d < ROPE.pickupRadius && hook.y < heli.pos.y - ROPE.pickupBelowHeli) {
          this.pickupCandidate = log;
          break;
        }
      }
    }

    // metriky: kyvadlo nákladu (plynulost), min. výška nad terénem s nákladem
    if (rope.attached) {
      const f = rope.attachForceOnHeli(new THREE.Vector3());
      const swing = Math.hypot(f.x, f.z); // vodorovná složka tahu = míra kmitání
      this.swingAccum += swing * dt;
      if (heli.telemetry.agl < this.minAglCarry) this.minAglCarry = heli.telemetry.agl;
    }
  }

  // Stisk mezerníku: chycení / uvolnění háku (7.3, 7.4).
  hookPress(heli: FlightModel, rope: RopeSim, logField: LogField): void {
    if (this.state !== 'flying') return;
    if (rope.broken) {
      // přetržené lano nelze použít — jen oznámení (hráč počká / restart směny)
      this.say('Lano je přetržené — směnu dokonči bez něj nebo restartuj (F5 uložení, nová hra).');
      return;
    }
    if (!rope.attached) {
      if (this.pickupCandidate) {
        rope.attachLoad(this.pickupCandidate);
        this.say(this.pick(DISPATCH_LINES.attached));
      }
      return;
    }
    // uvolnění nákladu
    const log = rope.detachLoad();
    if (!log) return;
    const hook = rope.hookPos;
    const c = new THREE.Vector3(WORLD.dropZone.x, 0, WORLD.dropZone.z);
    const horizDist = Math.hypot(hook.x - c.x, hook.z - c.z);
    this.releaseDists.push(horizDist);
    if (horizDist <= WORLD.dropZone.radius + WORLD.dropZone.tolerance) {
      log.delivered = true;
      this.deliveredCount += 1;
      this.say(this.pick(DISPATCH_LINES.delivered));
      // kmen vizuálně položíme na plochu
      log.group.position.set(
        c.x + (Math.random() - 0.5) * (WORLD.dropZone.radius - 2),
        log.group.position.y,
        c.z + (Math.random() - 0.5) * (WORLD.dropZone.radius - 2),
      );
      log.group.position.y = logField.world.heightAt(log.group.position.x, log.group.position.z) + log.diameter / 2;
    } else {
      log.fallen = true;
      this.say(this.pick(DISPATCH_LINES.droppedOutside));
    }
    if (logField.pendingCount() === 0) {
      this.finishShift();
    }
  }

  onRopeBroken(rope: RopeSim): void {
    if (rope.attached) rope.attached.fallen = true;
    this.say(this.pick(DISPATCH_LINES.ropeBroken));
  }

  onCrash(): void {
    this.say(this.pick(DISPATCH_LINES.crash));
  }

  private finishShift(): void {
    this.state = 'report';
    const total = this.deliveredCount;
    // plynulost: málo oscilací nákladu
    const smoothness = clamp01(1 - this.swingAccum / Math.max(1, total) / 40000);
    // přesnost odkladu: střední vzdálenost od středu kruhu
    const avgDist = this.releaseDists.length ? this.releaseDists.reduce((a, b) => a + b, 0) / this.releaseDists.length : WORLD.dropZone.radius;
    const accuracy = clamp01(1 - avgDist / (WORLD.dropZone.radius + WORLD.dropZone.tolerance));
    // bezpečnost: min. výška nad terénem při nošení nákladu
    const minAgl = this.minAglCarry === Infinity ? 50 : this.minAglCarry;
    const safety = clamp01(minAgl / 25);
    const score = smoothness * 0.4 + accuracy * 0.35 + safety * 0.25;
    const crosses = score > 0.66 ? 3 : score > 0.4 ? 2 : 1;
    const moneyEarned = MISSION.reportMoneyBase + total * MISSION.reportMoneyPerLog + crosses * MISSION.reportBonusPerCross;
    this.money += moneyEarned;
    this.save();
    const notes: string[] = [];
    notes.push(smoothness > 0.7 ? 'Plynulá jízda — kyvadlo nákladu téměř nekmitalo. Pěkná práce.' : smoothness > 0.4 ? 'Občasné zakývání nákladu, ale v mezích.' : 'Náklad hodně kmital — příště jemněji s kolektivem při rozjezdu a brzdění.');
    notes.push(accuracy > 0.7 ? 'Odklady přesně do středu kruhu. Radost pohledět.' : accuracy > 0.4 ? 'Odklady v kruhu, někde blíž ke kraji.' : 'Příště se soustřeď na střed vlaječky.');
    notes.push(safety > 0.7 ? 'Bezpečná výška nad terénem celou směnu.' : safety > 0.4 ? 'Hlídej si výšku nad korunami stromů.' : 'Příliš nízko nad terénem — stromy nerostou do nebe.');
    notes.push(`Vyděláno: ${moneyEarned} Kč. Celkem v pokladně: ${Math.round(this.money)} Kč.`);
    this.report = { shift: this.shift, delivered: total, total, crosses, moneyEarned, notes, smoothness, accuracy, safety };
    this.say(this.pick(DISPATCH_LINES.shiftDone));
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
