// Pokácené kmeny v těžební oblasti (oddíl 4.3): kvádr se zakulacenými konci
// ( kapsle ), barevná značka u paty = bod uchycení háku. Počet 8–12 na směnu.

import * as THREE from 'three';
import { MISSION, WORLD } from '../config';
import { mulberry32 } from '../utils/math';
import type { World } from './terrain';

export interface Log {
  id: number;
  pos: THREE.Vector3;        // střed kmene (na zemi)
  yaw: number;
  length: number;
  diameter: number;
  mass: number;
  delivered: boolean;
  attached: boolean;         // visí na háku
  fallen: boolean;           // spadl (po přetržení lana nebo puštění mimo plochu)
  group: THREE.Group;
  bodyMesh: THREE.Mesh;
  markColor: THREE.Color;
  attachPoint(): THREE.Vector3; // bod u paty kmene (kde má hák zabrat)
}

const MARK_COLORS = [0xff3333, 0x33ccff, 0xffee33, 0xff66ff, 0x66ff66, 0xff9933];

export class LogField {
  logs: Log[] = [];
  private scene: THREE.Scene;
  readonly world: World;

  constructor(scene: THREE.Scene, world: World) {
    this.scene = scene;
    this.world = world;
  }

  // Vygeneruje novou směnu: 8–12 kmenů rozházených po těžební oblasti.
  spawnShift(shift: number): void {
    for (const l of this.logs) this.scene.remove(l.group);
    this.logs = [];
    const rng = mulberry32(WORLD.seed ^ (shift * 7919));
    const count = MISSION.logsMin + Math.floor(rng() * (MISSION.logsMax - MISSION.logsMin + 1));
    const c = WORLD.loggingArea;
    for (let i = 0; i < count; i++) {
      // pozice uvnitř kruhu, s min. odstupem
      let x = 0, z = 0, ok = false;
      for (let tries = 0; tries < 40 && !ok; tries++) {
        const a = rng() * Math.PI * 2;
        const d = 6 + Math.sqrt(rng()) * (c.radius - 14);
        x = c.x + Math.cos(a) * d;
        z = c.z + Math.sin(a) * d;
        ok = this.logs.every((l) => Math.hypot(l.pos.x - x, l.pos.z - z) > 5);
      }
      const gy = this.world.heightAt(x, z);
      const length = MISSION.logLength[0] + rng() * (MISSION.logLength[1] - MISSION.logLength[0]);
      const diameter = MISSION.logDiameter[0] + rng() * (MISSION.logDiameter[1] - MISSION.logDiameter[0]);
      const mass = Math.round(MISSION.logMass[0] + rng() * (MISSION.logMass[1] - MISSION.logMass[0]));
      const yaw = rng() * Math.PI * 2;
      const markColor = new THREE.Color(MARK_COLORS[i % MARK_COLORS.length]);

      const group = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8a6a42, flatShading: true });
      const cap = new THREE.CapsuleGeometry(diameter / 2, length - diameter, 4, 8);
      cap.rotateZ(Math.PI / 2); // osa kapsle podél X
      const bodyMesh = new THREE.Mesh(cap, bodyMat);
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      group.add(bodyMesh);
      // barevná značka u paty (bod uchycení háku)
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(diameter / 2 + 0.03, diameter / 2 + 0.03, 0.5, 10),
        new THREE.MeshBasicMaterial({ color: markColor }),
      );
      band.rotation.z = Math.PI / 2;
      band.position.x = -length / 2 + 0.6;
      group.add(band);
      // lehká kůra: tenké podélné lišty
      const barkMat = new THREE.MeshLambertMaterial({ color: 0x6d5233, flatShading: true });
      for (let k = 0; k < 3; k++) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(length - 0.4, 0.06, 0.06), barkMat);
        const a = (k / 3) * Math.PI * 2;
        stripe.position.set(0, Math.sin(a) * diameter / 2, Math.cos(a) * diameter / 2);
        stripe.rotation.x = a;
        group.add(stripe);
      }
      group.position.set(x, gy + diameter / 2, z);
      group.rotation.y = yaw;
      this.scene.add(group);

      this.logs.push({
        id: i,
        pos: new THREE.Vector3(x, gy + diameter / 2, z),
        yaw,
        length,
        diameter,
        mass,
        delivered: false,
        attached: false,
        fallen: false,
        group,
        bodyMesh,
        markColor,
        attachPoint() {
          const p = new THREE.Vector3(-length / 2 + 0.6, 0.1, 0);
          return group.localToWorld(p.clone());
        },
      });
    }
  }

  // Nejbližší nepředaný kmen k pozici (pro cílový ukazatel mise).
  nearestPending(pos: THREE.Vector3): Log | null {
    let best: Log | null = null;
    let bd = Infinity;
    for (const l of this.logs) {
      if (l.delivered || l.attached) continue;
      const d = l.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  pendingCount(): number {
    return this.logs.filter((l) => !l.delivered).length;
  }

  // Kolize bodu lana s kmenem (kapsle ~ úsečka + poloměr) — oddíl 7.2.
  collidePoint(p: THREE.Vector3, out: THREE.Vector3, skipLog?: Log | null): boolean {
    for (const l of this.logs) {
      if (l === skipLog || l.attached) continue;
      const half = l.length / 2 - l.diameter / 2;
      const dir = new THREE.Vector3(Math.cos(l.yaw), 0, -Math.sin(l.yaw));
      const rel = p.clone().sub(l.pos);
      const t = clampLocal(rel.dot(dir), -half, half);
      const closest = l.pos.clone().addScaledVector(dir, t);
      const d = p.distanceTo(closest);
      if (d < l.diameter / 2 + 0.12) {
        const n = p.clone().sub(closest);
        if (n.lengthSq() < 1e-6) n.set(0, 1, 0);
        n.normalize();
        out.copy(closest).addScaledVector(n, l.diameter / 2 + 0.12);
        return true;
      }
    }
    return false;
  }
}

function clampLocal(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
