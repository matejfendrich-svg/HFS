// Svět: procedurální terén 2x2 km, instancované stromy, heliport, odkládací
// plocha, těžební oblast a kolizní data (oddíl 4). Výšková mapa je jedna
// analytická funkce — render i kolize z ní čerpají stejná data.

import * as THREE from 'three';
import { WORLD, TREES } from '../config';
import { terrainHeight, terrainNormal, waterLevelOf, type TerrainCfg } from '../utils/noise';
import { mulberry32, clamp } from '../utils/math';
import { mergeNonIndexed, nonIndexed } from '../utils/geom';

export interface TreeInstance {
  x: number;
  z: number;
  scale: number;
  species: number;
  topY: number;      // výška koruny nad zemí (včetně výšky terénu)
  radius: number;    // kolizní poloměr kmene
}

const GRID_CELL = 25;

export class World {
  readonly heightFn: (x: number, z: number) => number;
  readonly terrainCfg: TerrainCfg;
  readonly waterLevel: number;
  waterMesh!: THREE.Mesh;
  trees: TreeInstance[] = [];
  private grid = new Map<number, number[]>();
  terrainMesh!: THREE.Mesh;
  treeMeshes: THREE.InstancedMesh[] = [];
  dropZoneGroup = new THREE.Group();
  heliportGroup = new THREE.Group();
  loggingGroup = new THREE.Group();
  dropCenter = new THREE.Vector3(WORLD.dropZone.x, 0, WORLD.dropZone.z);
  loggingCenter = new THREE.Vector3(WORLD.loggingArea.x, 0, WORLD.loggingArea.z);

  constructor() {
    const n = WORLD.noise;
    this.terrainCfg = {
      seed: WORLD.seed,
      octaves: n.octaves,
      baseFrequency: n.baseFrequency,
      persistence: n.persistence,
      amplitude: n.amplitude,
      ridgeBoost: n.ridgeBoost,
      baseLift: n.baseLift,
      smoothRadius: n.smoothRadius,
      clearings: WORLD.treeClearings.map((c) => ({
        x: c.x, z: c.z, r: c.r,
        flat: (c.x === WORLD.heliport.x && c.z === WORLD.heliport.z) ? 0 : null, // přepíše se níže
      })),
      water: WORLD.water,
    };
    this.heightFn = (x, z) => terrainHeight(x, z, this.terrainCfg);
    this.waterLevel = waterLevelOf(this.terrainCfg);
    // heliport: malý pahorek nad vodní hladinou
    const hp = this.terrainCfg.clearings[0];
    hp.flat = this.waterLevel + 3;
    this.dropCenter.y = this.heightAt(WORLD.dropZone.x, WORLD.dropZone.z);
    this.loggingCenter.y = this.heightAt(WORLD.loggingArea.x, WORLD.loggingArea.z);
  }

  heightAt(x: number, z: number): number {
    return this.heightFn(x, z);
  }

  normalAt(x: number, z: number) {
    return terrainNormal(x, z, this.heightFn);
  }

  // --- terén ---------------------------------------------------------------
  buildTerrain(scene: THREE.Scene): void {
    const seg = WORLD.terrainSegments;
    const size = WORLD.size;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(0x5d7a3a);
    const cGrassDry = new THREE.Color(0x8a8a4a);
    const cForest = new THREE.Color(0x2e4a26);
    const cRock = new THREE.Color(0x6e6a63);
    const cSnow = new THREE.Color(0xb8bcc2);
    const cSand = new THREE.Color(0x9a8a5e);
    const tmp = new THREE.Color();
    // výšková mřížka se počítá jednou (analytická funkce zůstává pro kolize)
    const n = seg + 1;
    const grid = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        grid[iz * n + ix] = this.heightAt(-size / 2 + (size * ix) / seg, -size / 2 + (size * iz) / seg);
      }
    }
    const cell = size / seg;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const fx = clamp((x + size / 2) / cell, 0, seg - 1e-6);
      const fz = clamp((z + size / 2) / cell, 0, seg - 1e-6);
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      const tx = fx - ix;
      const tz = fz - iz;
      const h =
        grid[iz * n + ix] * (1 - tx) * (1 - tz) + grid[iz * n + ix + 1] * tx * (1 - tz) +
        grid[(iz + 1) * n + ix] * (1 - tx) * tz + grid[(iz + 1) * n + ix + 1] * tx * tz;
      pos.setY(i, h);
      const hR = grid[iz * n + Math.min(ix + 1, seg)];
      const hU = grid[Math.min(iz + 1, seg) * n + ix];
      const slope = Math.hypot((grid[iz * n + ix] - hR) / cell, (grid[iz * n + ix] - hU) / cell);
      const t = clamp(h / WORLD.noise.amplitude, 0, 1);
      if (h < this.waterLevel + 0.9) tmp.copy(cSand); // břeh u vody
      else if (slope > 0.55) tmp.copy(cRock);
      else if (h > WORLD.noise.amplitude * 0.72) tmp.copy(cSnow).lerp(cRock, 0.4);
      else tmp.copy(cGrass).lerp(cForest, clamp(t * 1.4, 0, 1)).lerp(cGrassDry, clamp((slope - 0.18) * 2, 0, 0.5));
      // lokální stínění podle výšky kolem (ambient occlusion-lite)
      const ao = clamp(1 - (hR - h) * 0.02 - (hU - h) * 0.02, 0.75, 1.1);
      colors[i * 3] = tmp.r * ao;
      colors[i * 3 + 1] = tmp.g * ao;
      colors[i * 3 + 2] = tmp.b * ao;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const flat = nonIndexed(geo);
    flat.computeVertexNormals(); // flat shading přes neindexovanou geometrii
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.terrainMesh = new THREE.Mesh(flat, mat);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.name = 'terrain';
    scene.add(this.terrainMesh);

    // vodní hladina: jedna průhledná plocha přes celou mapu — vidět je jen tam,
    // kde terén (řeka, přítok, jezero) klesne pod hladinu
    const waterGeo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    this.waterMesh = new THREE.Mesh(waterGeo, new THREE.MeshPhongMaterial({
      color: 0x2e6f9e, transparent: true, opacity: 0.72, shininess: 140, specular: 0x88bbdd,
    }));
    this.waterMesh.position.y = this.waterLevel;
    this.waterMesh.name = 'water';
    scene.add(this.waterMesh);
  }

  // --- stromy ---------------------------------------------------------------
  buildTrees(scene: THREE.Scene): void {
    const rng = mulberry32(WORLD.seed ^ 0x9e3779b9);
    const clearings = WORLD.treeClearings;
    // rozmísťovací grid — rychlá kontrola min. rozestupu (bez O(n²))
    const placeGrid = new Map<number, { x: number; z: number }[]>();
    const pKey = (x: number, z: number) => (Math.floor(x / 12) + 512) * 1024 + (Math.floor(z / 12) + 512);
    const nearTree = (x: number, z: number) => {
      const k = pKey(x, z);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = placeGrid.get(k + dx * 1024 + dz);
          if (arr && arr.some((t) => Math.hypot(x - t.x, z - t.z) < WORLD.treeMinDist)) return true;
        }
      }
      return false;
    };
    let attempts = 0;
    while (this.trees.length < WORLD.treeCount && attempts < WORLD.treeCount * 30) {
      attempts++;
      const x = (rng() - 0.5) * WORLD.size * 0.98;
      const z = (rng() - 0.5) * WORLD.size * 0.98;
      if (clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
      if (nearTree(x, z)) continue;
      const scale = TREES.minScale + rng() * (TREES.maxScale - TREES.minScale);
      const species = Math.floor(rng() * TREES.species);
      const groundY = this.heightAt(x, z);
      this.trees.push({
        x, z, scale, species,
        topY: groundY + (TREES.trunkHeight + TREES.crownHeight) * scale,
        radius: TREES.trunkRadius * scale * TREES.collisionRadiusFactor,
      });
      const k = pKey(x, z);
      let arr = placeGrid.get(k);
      if (!arr) { arr = []; placeGrid.set(k, arr); }
      arr.push({ x, z });
    }
    // grid pro rychlé dotazy
    this.trees.forEach((t, i) => {
      const key = this.cellKey(t.x, t.z);
      let arr = this.grid.get(key);
      if (!arr) { arr = []; this.grid.set(key, arr); }
      arr.push(i);
    });

    // 2 instancované sady na druh: kmen + koruna smrku (3 přesazené kužely),
    // geometrie v reálných metrech — instance se škáluje jen uniformně
    const trunkGeo = nonIndexed(new THREE.CylinderGeometry(TREES.trunkRadius * 0.72, TREES.trunkRadius, TREES.trunkHeight, 6, 1, true));
    trunkGeo.translate(0, TREES.trunkHeight / 2, 0); // základ v 0
    const coneGeos: THREE.BufferGeometry[] = [];
    const ch = TREES.crownHeight / (TREES.crownCones - 0.5); // výška jednoho kužele
    for (let i = 0; i < TREES.crownCones; i++) {
      const r = 2.4 * (1 - 0.3 * i);
      const cone = nonIndexed(new THREE.ConeGeometry(r, ch, 6, 1, true)); // bez základen = méně tri
      cone.translate(0, TREES.trunkHeight * 0.9 + i * ch * 0.55 + ch / 2 - 1.0, 0);
      coneGeos.push(cone);
    }
    const crownGeo = mergeNonIndexed(coneGeos);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a4632, flatShading: true });
    const crownMats = [
      new THREE.MeshLambertMaterial({ color: 0x2d5230, flatShading: true }),
      new THREE.MeshLambertMaterial({ color: 0x274a2e, flatShading: true }),
      new THREE.MeshLambertMaterial({ color: 0x35603a, flatShading: true }),
    ];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    for (let s = 0; s < TREES.species; s++) {
      const idx = this.trees.map((t, i) => (t.species === s ? i : -1)).filter((i) => i >= 0);
      if (idx.length === 0) continue;
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, idx.length);
      const crowns = new THREE.InstancedMesh(crownGeo, crownMats[s], idx.length);
      idx.forEach((ti, k) => {
        const t = this.trees[ti];
        const gy = this.heightAt(t.x, t.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (t.x * 12.9898 + t.z * 78.233) % (Math.PI * 2));
        m4.compose(
          new THREE.Vector3(t.x, gy, t.z),
          q,
          new THREE.Vector3(t.scale, t.scale, t.scale),
        );
        trunks.setMatrixAt(k, m4);
        crowns.setMatrixAt(k, m4);
        col.setHSL(0.33 + ((t.x * 7.13) % 1) * 0.03, 0.45, 0.32 + ((t.z * 3.7) % 1) * 0.1);
        crowns.setColorAt(k, col);
      });
      trunks.castShadow = true;
      crowns.castShadow = true;
      trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
      scene.add(trunks, crowns);
      this.treeMeshes.push(trunks, crowns);
    }
  }

  private cellKey(x: number, z: number): number {
    return (Math.floor(x / GRID_CELL) + 512) * 1024 + (Math.floor(z / GRID_CELL) + 512);
  }

  // Stromy v okolí bodu — kolize trupu i rotorového disku (oddíl 4.2, 6).
  treesNear(x: number, z: number, radius: number): TreeInstance[] {
    const out: TreeInstance[] = [];
    const r = Math.ceil(radius / GRID_CELL);
    const cx = Math.floor(x / GRID_CELL);
    const cz = Math.floor(z / GRID_CELL);
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const arr = this.grid.get((ix + 512) * 1024 + (iz + 512));
        if (!arr) continue;
        for (const i of arr) {
          const t = this.trees[i];
          if (Math.hypot(t.x - x, t.z - z) <= radius + t.radius) out.push(t);
        }
      }
    }
    return out;
  }

  // --- heliport (jen vizuál, oddíl 4.5) --------------------------------------
  buildHeliport(scene: THREE.Scene): void {
    const g = this.heliportGroup;
    const gy = this.heightAt(WORLD.heliport.x, WORLD.heliport.z);
    const wood = new THREE.MeshLambertMaterial({ color: 0x8a6b45, flatShading: true });
    const darkWood = new THREE.MeshLambertMaterial({ color: 0x6b5136, flatShading: true });
    // dřevěná plocha 12x12 m z prken
    const deck = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 12), wood);
    deck.position.set(0, gy + 0.15, 0);
    deck.receiveShadow = true;
    g.add(deck);
    for (let i = -5; i <= 5; i += 2) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.34, 12), darkWood);
      plank.position.set(i, gy + 0.17, 0);
      g.add(plank);
    }
    // značení H
    const hMat = new THREE.MeshBasicMaterial({ color: 0xf2e8c9 });
    const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 3.2), hMat);
    const h2 = h1.clone();
    h1.position.set(-0.9, gy + 0.36, 0);
    h2.position.set(0.9, gy + 0.36, 0);
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.5), hMat);
    hBar.position.set(0, gy + 0.36, 0);
    g.add(h1, h2, hBar);
    // hangár vzadu
    const hangar = new THREE.Mesh(new THREE.BoxGeometry(8, 4.5, 6), darkWood);
    hangar.position.set(0, gy + 2.25, -12);
    hangar.castShadow = true;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 8.2, 3, 1), wood);
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 2;
    roof.scale.y = 1;
    roof.position.set(0, gy + 4.5, -12);
    roof.castShadow = true;
    g.add(hangar, roof);
    scene.add(g);
  }

  // --- odkládací plocha: kruh z latí + vlaječka (oddíl 4.4) -------------------
  buildDropZone(scene: THREE.Scene): void {
    const g = this.dropZoneGroup;
    const c = this.dropCenter;
    const wood = new THREE.MeshLambertMaterial({ color: 0x9a7b50, flatShading: true });
    const R = WORLD.dropZone.radius;
    const slats = 18;
    for (let i = 0; i < slats; i++) {
      const a = (i / slats) * Math.PI * 2;
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.35), wood);
      slat.position.set(c.x + Math.cos(a) * R, c.y + 0.13, c.z + Math.sin(a) * R);
      slat.rotation.y = -a + Math.PI / 2;
      slat.castShadow = true;
      g.add(slat);
    }
    // vlaječka
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.5, 6), wood);
    pole.position.set(c.x, c.y + 2.25, c.z);
    pole.castShadow = true;
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 0, 0, 1.6, -0.35, 0, 0, -0.8, 0,
    ]), 3));
    flagGeo.computeVertexNormals();
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: 0xff5533, side: THREE.DoubleSide }));
    flag.position.set(c.x, c.y + 4.4, c.z);
    g.add(pole, flag);
    // podkladový kruh na zemi (průhledný terč)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R - 0.6, R, 48),
      new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(c.x, c.y + 0.06, c.z);
    g.add(ring);
    scene.add(g);
  }

  // --- těžební oblast: barevné vyznačení na zemi (oddíl 4.3) -------------------
  buildLoggingArea(scene: THREE.Scene): void {
    const g = this.loggingGroup;
    const c = this.loggingCenter;
    const R = WORLD.loggingArea.radius;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R - 1.2, R, 64),
      new THREE.MeshBasicMaterial({ color: 0xff7722, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(c.x, c.y + 0.08, c.z);
    g.add(ring);
    // několik pařezů jako dekorace
    const stumpMat = new THREE.MeshLambertMaterial({ color: 0x7a5c3a, flatShading: true });
    const rng = mulberry32(WORLD.seed ^ 0x1234);
    for (let i = 0; i < 10; i++) {
      const a = rng() * Math.PI * 2;
      const d = 8 + rng() * (R - 16);
      const x = c.x + Math.cos(a) * d;
      const z = c.z + Math.sin(a) * d;
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.7, 7), stumpMat);
      stump.position.set(x, this.heightAt(x, z) + 0.35, z);
      stump.castShadow = true;
      g.add(stump);
    }
    scene.add(g);
  }
}
