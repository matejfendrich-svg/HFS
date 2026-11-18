// ============================================================================
// Procedurální low-poly model vrtulníku (oddíl 15): fiktivní těžký dvoumotorový
// „létající jeřáb“ Skyhaul SH-6 — silueta a proporce podle předpisu
// (šestilistý rotor Ø21,9 m, otevřená kostra center-spine, odkryté motory,
// čtyřlistý ocasní rotor, pevný trojkolový podvozek, závěsný bod pod těžištěm).
// Žádné reálné značky/loga/im.atrikulace. Vše generováno kódem, flat shading,
// rozpočet < 5 000 trojúhelníků.
// Osa trupu: forward = −Z, up = +Y, right = +X. Těžiště v ose skupiny.
// ============================================================================

import * as THREE from 'three';
import type { HeliTypeConfig } from '../config';
import { smoothstep } from '../utils/math';

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function cyl(rt: number, rb: number, len: number, mat: THREE.Material, seg = 10): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), mat);
  m.castShadow = true;
  return m;
}

export class HeliModel {
  group = new THREE.Group();
  rotorGroup = new THREE.Group();      // hlavní rotor (otáčí se)
  tailRotorGroup = new THREE.Group();  // ocasní rotor
  blurDisk!: THREE.Mesh;               // poloprůhledný disk při vysokých Ω
  tailBlurDisk!: THREE.Mesh;
  winchDrum!: THREE.Mesh;             // cívka navijáku na břiše
  hookMarker!: THREE.Mesh;
  private rotorAngle = 0;
  private tailAngle = 0;
  private omegaNom: number;

  constructor(type: HeliTypeConfig) {
    this.omegaNom = (type.rotorRpmNom * 2 * Math.PI) / 60;
    const orange = new THREE.MeshLambertMaterial({ color: 0xe8622a, flatShading: true });
    const white = new THREE.MeshLambertMaterial({ color: 0xf0ede6, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2b2b2e, flatShading: true });
    const steel = new THREE.MeshLambertMaterial({ color: 0x8f9296, flatShading: true });
    const glass = new THREE.MeshLambertMaterial({ color: 0x1d2733, transparent: true, opacity: 0.85, flatShading: true });
    const tire = new THREE.MeshLambertMaterial({ color: 0x1a1a1a, flatShading: true });

    const g = this.group;
    const L = type.fuselageLength; // 21,5 m podél Z

    // --- přední gondola (kokpit) — hranatá, zavěšená pod předkem kostry ---
    const gondola = box(3.4, 2.7, 6.0, orange, 0, -0.4, -L / 2 + 3.2);
    g.add(gondola);
    // kabinová skla — tmavé průhledné plochy vpředu a po stranách
    g.add(box(3.0, 1.0, 0.1, glass, 0, 0.55, -L / 2 + 0.25));
    g.add(box(0.1, 0.9, 2.6, glass, -1.62, 0.5, -L / 2 + 2.6));
    g.add(box(0.1, 0.9, 2.6, glass, 1.62, 0.5, -L / 2 + 2.6));
    // bílý pruh podél gondoly
    g.add(box(3.44, 0.35, 4.4, white, 0, -0.75, -L / 2 + 3.4));

    // --- otevřená prostorová kostra (center-spine) bez krytů ---
    const spineZ0 = -L / 2 + 6.0;
    const spineZ1 = L / 2 - 2.6;
    const spineLen = spineZ1 - spineZ0;
    const spineZc = (spineZ0 + spineZ1) / 2;
    const hw = 0.85; // poloviční šířka kostry
    const hh = 0.95; // poloviční výška kostry
    for (const sx of [-hw, hw]) {
      for (const sy of [-hh, hh]) {
        const lon = box(0.14, 0.14, spineLen, steel, sx, sy + 0.6, spineZc);
        g.add(lon);
      }
    }
    // příčky a diagonály kostry
    const nBays = 8;
    for (let i = 0; i <= nBays; i++) {
      const z = spineZ0 + (spineLen * i) / nBays;
      g.add(box(2 * hw + 0.14, 0.1, 0.1, steel, 0, 0.6 + hh, z));
      g.add(box(2 * hw + 0.14, 0.1, 0.1, steel, 0, 0.6 - hh, z));
      g.add(box(0.1, 2 * hh + 0.1, 0.1, steel, -hw, 0.6, z));
      g.add(box(0.1, 2 * hh + 0.1, 0.1, steel, hw, 0.6, z));
      if (i < nBays) {
        const z2 = spineZ0 + (spineLen * (i + 1)) / nBays;
        const diag = box(0.08, Math.hypot(2 * hh, (z2 - z)), 0.08, steel, 0, 0.6, (z + z2) / 2);
        diag.rotation.x = Math.atan2(2 * hh, z2 - z);
        g.add(diag);
      }
    }
    // bílé krycí panely na bocích kostry (jen částečné — kostra zůstává otevřená)
    g.add(box(0.06, 0.9, spineLen * 0.55, white, -hw - 0.02, 0.85, spineZc));
    g.add(box(0.06, 0.9, spineLen * 0.55, white, hw + 0.02, 0.85, spineZc));

    // --- dva odkryté turbínové motory nad trupem ---
    for (const sx of [-1.35, 1.35]) {
      const eng = cyl(0.55, 0.62, 3.2, dark, 12);
      eng.rotation.x = Math.PI / 2;
      eng.position.set(sx, 2.15, -3.6);
      g.add(eng);
      const intake = cyl(0.34, 0.5, 0.9, steel, 10);
      intake.rotation.x = Math.PI / 2;
      intake.position.set(sx, 2.15, -5.35);
      g.add(intake);
      const exhaust = cyl(0.42, 0.34, 0.8, dark, 10);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(sx, 2.15, -1.95);
      g.add(exhaust);
      // bílý kryt převodovky mezi motory
    }
    const gearbox = box(1.7, 0.9, 2.4, white, 0, 2.3, -3.4);
    g.add(gearbox);

    // --- hlavní rotor: stožár + 6 úzkých listů ---
    const hubY = type.hubHeight;
    const hubZ = -1.0;
    const mast = cyl(0.28, 0.36, 1.2, dark, 8);
    mast.position.set(0, hubY - 0.4, hubZ);
    g.add(mast);
    this.rotorGroup.position.set(0, hubY + 0.25, hubZ);
    const bladeLen = type.rotorDiameter / 2 - 0.6;
    const bladeMat = new THREE.MeshLambertMaterial({ color: 0x33363a, flatShading: true });
    for (let i = 0; i < type.rotorBlades; i++) {
      const a = (i / type.rotorBlades) * Math.PI * 2;
      const blade = box(type.bladeChord, 0.06, bladeLen, bladeMat, 0, 0, -bladeLen / 2 - 0.5);
      const holder = new THREE.Group();
      holder.rotation.y = a;
      holder.add(blade);
      this.rotorGroup.add(holder);
    }
    const hubCap = cyl(0.5, 0.5, 0.3, orange, 10);
    hubCap.position.y = -0.1;
    this.rotorGroup.add(hubCap);
    // rozostřená stopa listů (viditelná při vysokých otáčkách, oddíl 15)
    const blurGeo = new THREE.CircleGeometry(type.rotorDiameter / 2, 40);
    blurGeo.rotateX(-Math.PI / 2);
    this.blurDisk = new THREE.Mesh(
      blurGeo,
      new THREE.MeshBasicMaterial({ color: 0x555a60, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.blurDisk.position.y = 0.05;
    this.rotorGroup.add(this.blurDisk);
    g.add(this.rotorGroup);

    // --- ocasní rameno + plocha + čtyřlistý ocasní rotor ---
    const tail = cyl(0.16, 0.3, 3.4, orange, 8);
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, 0.9, L / 2 - 1.2);
    g.add(tail);
    const fin = box(0.12, 1.8, 1.4, orange, 0, 1.6, L / 2 - 0.4);
    g.add(fin);
    const finTop = box(0.1, 0.5, 1.2, white, 0, 2.6, L / 2 - 0.4);
    g.add(finTop);
    this.tailRotorGroup.position.set(0.35, 1.5, L / 2 - 0.2);
    const tBladeLen = 1.9;
    for (let i = 0; i < type.tailRotorBlades; i++) {
      const a = (i / type.tailRotorBlades) * Math.PI * 2;
      const blade = box(0.22, tBladeLen, 0.05, bladeMat, 0, tBladeLen / 2 + 0.2, 0);
      const holder = new THREE.Group();
      holder.rotation.z = a;
      holder.add(blade);
      this.tailRotorGroup.add(holder);
    }
    const tBlurGeo = new THREE.CircleGeometry(tBladeLen + 0.3, 24);
    this.tailBlurDisk = new THREE.Mesh(
      tBlurGeo,
      new THREE.MeshBasicMaterial({ color: 0x555a60, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.tailRotorGroup.add(this.tailBlurDisk);
    g.add(this.tailRotorGroup);

    // --- pevný trojkolový podvozek (přední + dvě hlavní kola) ---
    const wheel = (x: number, y: number, z: number): THREE.Group => {
      const wg = new THREE.Group();
      const w = cyl(0.42, 0.42, 0.3, tire, 10);
      w.rotation.z = Math.PI / 2;
      wg.add(w);
      const hub = cyl(0.18, 0.18, 0.34, steel, 8);
      hub.rotation.z = Math.PI / 2;
      wg.add(hub);
      wg.position.set(x, y, z);
      return wg;
    };
    g.add(wheel(0, -2.5, -L / 2 + 2.2));          // přední kolo
    g.add(wheel(-1.7, -2.6, 0.6));                // levé hlavní
    g.add(wheel(1.7, -2.6, 0.6));                 // pravé hlavní
    g.add(box(0.12, 1.4, 0.12, steel, 0, -1.8, -L / 2 + 2.2));
    g.add(box(0.12, 1.5, 0.12, steel, -1.7, -1.85, 0.6));
    g.add(box(0.12, 1.5, 0.12, steel, 1.7, -1.85, 0.6));
    g.add(box(3.6, 0.12, 0.12, steel, 0, -2.35, 0.6)); // příčná vzpěra hlavního podvozku

    // --- závěsný bod + cívka navijáku na břiše (oddíly 7.1, 7.5) ---
    this.winchDrum = cyl(0.35, 0.35, 0.9, steel, 10);
    this.winchDrum.rotation.z = Math.PI / 2;
    this.winchDrum.position.set(0, type.attachOffsetY + 0.35, -0.5);
    g.add(this.winchDrum);
    this.hookMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffcc00 }),
    );
    this.hookMarker.position.set(0, type.attachOffsetY - 0.15, -0.5);
    g.add(this.hookMarker);

    // --- zadní stanoviště operátora nákladu (jen silueta, oddíl 15) ---
    const lmZ = L / 2 - 4.6;
    g.add(box(1.3, 0.08, 1.1, dark, 0, -0.55, lmZ));       // sedačka/platforma
    g.add(box(1.3, 1.0, 0.08, dark, 0, 0.0, lmZ + 0.55));  // zadní opěradlo
    g.add(box(0.08, 1.0, 1.1, dark, -0.62, 0.0, lmZ));
    g.add(box(0.08, 1.0, 1.1, dark, 0.62, 0.0, lmZ));
    g.add(box(0.7, 0.5, 0.06, glass, 0, 0.35, lmZ - 0.5)); // malé čelní sklo
  }

  // Vizální aktualizace: otáčení rotorů podle Ω, rozostření, cívka navijáku.
  update(dt: number, omega: number, winchRate: number): void {
    this.rotorAngle += omega * dt;
    this.tailAngle += omega * dt * 5.1; // ocasní rotor je rychlejší
    this.rotorGroup.rotation.y = this.rotorAngle;
    this.tailRotorGroup.rotation.x = this.tailAngle;
    const frac = omega / this.omegaNom;
    (this.blurDisk.material as THREE.MeshBasicMaterial).opacity = smoothstep(0.45, 0.9, frac) * 0.33;
    (this.tailBlurDisk.material as THREE.MeshBasicMaterial).opacity = smoothstep(0.45, 0.9, frac) * 0.3;
    this.winchDrum.rotation.x += winchRate * dt * 3;
  }
}
