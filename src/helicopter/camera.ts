// ============================================================================
// Kamerový rig (oddíl 6, body 5a–5d): doprovodná kamera 3. osoby s vyhlazením
// polohy i orientace (τ = 0,3 s), volné rozhlížení při řízení (pravé tlačítko),
// zoom, kolizní ochrana proti terénu a stromům, změkčený roll (20–30 %),
// kamerové mikro-otřesy < 0,2° (jediné povolené chvění, 5.4) a pohled na
// naviják (hook cam: off / obraz v obrazu / celá obrazovka, klávesa H).
// ============================================================================

import * as THREE from 'three';
import { CAMERA, RENDER } from '../config';
import { clamp, lerp } from '../utils/math';
import type { World } from '../world/terrain';

export type CamView = 'chase' | 'cockpit' | 'high' | 'side';

export class CameraRig {
  view: CamView = 'chase';
  freeYaw = 0;
  freePitch = 0;
  zoom: number;
  hookCam: 'off' | 'pip' | 'full' = 'off';
  readonly hookCamera: THREE.PerspectiveCamera;
  private camPos = new THREE.Vector3();
  private lookQuat = new THREE.Quaternion();
  private lookInit = false;
  private initialized = false;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly upMix = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private shakeT = 0;

  constructor(fov: number, zoom: number) {
    this.zoom = zoom;
    this.hookCamera = new THREE.PerspectiveCamera(fov, 1, 0.1, RENDER.skyRadius * 2);
  }

  reset(): void {
    this.initialized = false;
    this.lookInit = false;
  }

  cycleView(views: readonly string[]): void {
    const i = views.indexOf(this.view);
    this.view = views[(i + 1) % views.length] as CamView;
    this.freeYaw = 0;
    this.freePitch = 0;
  }

  cycleHookCam(): void {
    const modes = CAMERA.hookCamModes;
    const i = modes.indexOf(this.hookCam);
    this.hookCam = modes[(i + 1) % modes.length];
  }

  // free look: orbit kolem vrtulníku při držení pravého tlačítka (řízení pokračuje)
  freeLook(d: { x: number; y: number }): void {
    this.freeYaw -= d.x * 0.0035;
    this.freePitch = clamp(this.freePitch - d.y * 0.0035, -1.2, 1.2);
  }

  update(
    dt: number,
    heliPos: THREE.Vector3,
    heliQuat: THREE.Quaternion,
    freeLookHeld: boolean,
    world: World,
    camera: THREE.PerspectiveCamera,
  ): void {
    const q = heliQuat;
    const fwd = this.tmpV.set(0, 0, -1).applyQuaternion(q);
    const up = this.tmpV2.set(0, 1, 0).applyQuaternion(q);
    if (!freeLookHeld && this.view === 'chase') {
      // měkký návrat za vrtulník po puštění rozhledu
      this.freeYaw = lerp(this.freeYaw, 0, 1 - Math.exp(-dt / 0.5));
      this.freePitch = lerp(this.freePitch, 0, 1 - Math.exp(-dt / 0.5));
    }
    const zoom = clamp(this.zoom, CAMERA.zoomMin, CAMERA.zoomMax);
    if (this.view === 'cockpit') {
      this.desired.copy(heliPos).addScaledVector(fwd, 2.0).addScaledVector(up, 1.4);
      this.lookAt.copy(heliPos).addScaledVector(fwd, 30).addScaledVector(up, 1.0);
    } else if (this.view === 'high') {
      this.desired.copy(heliPos).add(this.tmpV.set(0, 38, 0));
      this.lookAt.copy(heliPos);
    } else if (this.view === 'side') {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      this.desired.copy(heliPos).addScaledVector(right, 20).add(this.tmpV.set(0, 4, 0));
      this.lookAt.copy(heliPos);
    } else {
      // chase: za strojem, výška, volný rozhled jako orbit
      const back = fwd.clone().multiplyScalar(-zoom);
      back.y += CAMERA.chaseHeight * (zoom / CAMERA.chaseDist);
      back.y += this.freePitch * 6;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      back.addScaledVector(right, -this.freeYaw * 12);
      this.desired.copy(heliPos).add(back);
      this.lookAt.copy(heliPos).addScaledVector(fwd, CAMERA.lookAhead).addScaledVector(up, 1.2);
    }
    // vyhlazení polohy (τ = smoothingTau) — žádné skoky
    if (!this.initialized) {
      this.camPos.copy(this.desired);
      this.initialized = true;
    }
    const k = 1 - Math.exp(-dt / CAMERA.smoothingTau);
    if (this.view === 'cockpit') this.camPos.copy(this.desired);
    else this.camPos.lerp(this.desired, k);
    // kolizní ochrana kamery: nesmí do terénu ani do kmenů (6.5c)
    const minY = world.heightAt(this.camPos.x, this.camPos.z) + 0.6;
    if (this.camPos.y < minY) this.camPos.y = minY;
    for (const tr of world.treesNear(this.camPos.x, this.camPos.z, 3.5)) {
      const gy = world.heightAt(tr.x, tr.z);
      const d = Math.hypot(this.camPos.x - tr.x, this.camPos.z - tr.z);
      if (d < tr.radius + 1.4 && this.camPos.y < tr.topY && this.camPos.y > gy) {
        const push = this.tmpV.set(this.camPos.x - tr.x, 0, this.camPos.z - tr.z).normalize();
        this.camPos.addScaledVector(push, tr.radius + 1.4 - d);
      }
    }
    // orientace: up = směs světové a trupové „nahoru“ podle rollFactor (jen 20–30 % roll)
    this.upMix.set(0, 1, 0).lerp(up, CAMERA.rollFactor).normalize();
    this.tmpQ.setFromRotationMatrix(new THREE.Matrix4().lookAt(this.camPos, this.lookAt, this.upMix));
    if (!this.lookInit) {
      this.lookQuat.copy(this.tmpQ);
      this.lookInit = true;
    }
    camera.position.copy(this.camPos);
    camera.quaternion.slerp(this.lookQuat, k).normalize();
    this.lookQuat.copy(camera.quaternion);
    this.shakeT += dt;
  }

  // kamerové mikro-otřesy — volá se z main s omegaFrac (amplituda < 0,2°)
  applyMicroShake(camera: THREE.PerspectiveCamera, omegaFrac: number): void {
    const amp = (CAMERA.microShakeMaxDeg * Math.PI / 180) * clamp(omegaFrac, 0, 1);
    const t = this.shakeT;
    camera.rotateX(Math.sin(t * 31.7) * 0.5 * amp + Math.sin(t * 47.3) * 0.5 * amp * 0.3);
    camera.rotateY(Math.sin(t * 27.1) * 0.5 * amp);
    camera.rotateZ(Math.sin(t * 41.7) * 0.5 * amp * 0.4);
  }

  // hook cam (6.5d): kamera pod trupem, namířená dolů podél lana na hák
  updateHookCam(heliPos: THREE.Vector3, heliQuat: THREE.Quaternion, hookPos: THREE.Vector3, fov: number): void {
    const belly = this.tmpV.set(0, -1.1, 0.6).applyQuaternion(heliQuat).add(heliPos);
    this.hookCamera.position.copy(belly);
    this.hookCamera.up.set(0, 0, -1).applyQuaternion(heliQuat); // „nahoru“ v obraze = dopředu stroje
    this.hookCamera.lookAt(hookPos.x, hookPos.y - 3, hookPos.z);
    this.hookCamera.fov = fov;
    this.hookCamera.aspect = 1; // PiP čtverec; při full se nastaví z canvasu
    this.hookCamera.updateProjectionMatrix();
  }
}
