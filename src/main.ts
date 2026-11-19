// ============================================================================
// ROTOR LOGGER — hlavní modul (oddíl 3): herní smyčka, fixní fyzikální krok
// 120 Hz s interpolací renderu (6.7d), kamera, světlo a den/noc, propojení
// světa, letového modelu, navijáku, mise, HUD a zvuku.
// ============================================================================

import * as THREE from 'three';
import {
  WORLD, PHYSICS, CONTROLS, CAMERA, TIME, WEATHER, RENDER, HELI_TYPES, HELI_TYPE_INDEX, ROPE,
  FLIGHT_MODES, TIME_OF_DAY, GRAPHICS,
} from './config';
import { clamp, lerp, wrapAngle, DEG } from './utils/math';
import { World } from './world/terrain';
import { LogField } from './world/logs';
import { FlightModel, type FlightEnv, type FlightInput } from './helicopter/flightModel';
import { HeliModel } from './helicopter/heliModel';
import { Controls } from './helicopter/controls';
import { RopeSim, type RopeEnv } from './rope/ropeSim';
import { Mission } from './game/mission';
import { Hud } from './ui/hud';
import { SoundEngine } from './audio/sound';
import { CameraRig } from './helicopter/camera';

type GameState = 'menu' | 'playing' | 'paused';

const MODE_LABELS: Record<string, string> = {
  manual: 'MANUAL (plný realismus)',
  stabilized: 'STABILIZOVANÝ',
};

class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private world = new World();
  private logField: LogField;
  private heliType = HELI_TYPES[HELI_TYPE_INDEX];
  private heli = new FlightModel(this.heliType);
  private heliModel: HeliModel;
  private rope: RopeSim;
  private ropeLine: THREE.Line;
  private ropeGeo: THREE.BufferGeometry;
  private hookMesh: THREE.Mesh;
  private targetBeacon: THREE.Mesh;
  private dropBeacon: THREE.Mesh;
  private controls: Controls;
  private hud: Hud;
  private mission = new Mission();
  private sound = new SoundEngine();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private skyMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private state: GameState = 'menu';
  private hour = TIME.startHour;
  private accumulator = 0;
  private lastTime = 0;
  private fps = 60;
  private showHelp = false;
  private showTelemetry = false;
  private camRig!: CameraRig;
  private dust: THREE.Points | null = null;
  private crashTimer = 0;
  private wasRopeBroken = false;
  private settingsOpen = false;
  private rain: THREE.Points | null = null;
  private lightningTimer = 0;
  private nightFrac = 0;
  private stormActive = false;
  private windFactor = 0;
  private fogFarMul = 1;
  private lastMode = '';
  // interpolace: stav před posledním fyzikálním krokem
  private prev = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, omega: 0 };
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpV3 = new THREE.Vector3();
  private readonly wind = new THREE.Vector3();
  private ropeEnv: RopeEnv;
  private flightEnv: FlightEnv;

  constructor() {
    const app = document.getElementById('app')!;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3; // 17.4: hra musí být vidět
    app.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, RENDER.skyRadius * 2);
    this.camera.position.set(0, 30, 60);

    // svět
    this.world.buildTerrain(this.scene);
    this.world.buildTrees(this.scene);
    this.world.buildHeliport(this.scene);
    this.world.buildDropZone(this.scene);
    this.world.buildLoggingArea(this.scene);
    this.logField = new LogField(this.scene, this.world);
    this.mission.startShift(this.logField, this.mission.shift);

    // světla
    this.hemi = new THREE.HemisphereLight(0xbfd4e6, 0x3a4a33, 0.7);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    const sb = RENDER.shadowBox / 2;
    this.sun.shadow.camera.left = -sb;
    this.sun.shadow.camera.right = sb;
    this.sun.shadow.camera.top = sb;
    this.sun.shadow.camera.bottom = -sb;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 900;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.fog = new THREE.Fog(0xc7d6e0, RENDER.fogNear, RENDER.fogFar);

    // obloha: gradient podle výšky + slunce (jednoduchý shader)
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x3a6ea8) },
        bottomColor: { value: new THREE.Color(0xc7d6e0) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(0xffe0b0) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 bottomColor; uniform vec3 sunDir; uniform vec3 sunColor;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -1.0, 1.0);
          vec3 col = mix(bottomColor, topColor, pow(max(h, 0.0), 0.65));
          float s = max(dot(vDir, sunDir), 0.0);
          col += sunColor * (pow(s, 350.0) * 0.9 + pow(s, 8.0) * 0.22);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(RENDER.skyRadius, 24, 16), this.skyMat);
    this.scene.add(sky);

    // hvězdy (viditelné v noci)
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.acos(Math.random() * 0.95);
      const r = RENDER.skyRadius - 500;
      starPos[i * 3] = r * Math.sin(e) * Math.cos(a);
      starPos[i * 3 + 1] = r * Math.cos(e) + 50;
      starPos[i * 3 + 2] = r * Math.sin(e) * Math.sin(a);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0 }));
    this.scene.add(this.stars);

    // vrtulník
    const startY = this.world.heightAt(WORLD.heliport.x, WORLD.heliport.z) + 2.7;
    this.heli.reset(WORLD.heliport.x, startY, WORLD.heliport.z);
    this.heliModel = new HeliModel(this.heliType);
    this.scene.add(this.heliModel.group);

    // lano: čára + hák
    this.rope = new RopeSim(this.heliType.hookMaxLoad);
    this.rope.reset(this.heli.attachPos(new THREE.Vector3()));
    this.ropeGeo = new THREE.BufferGeometry();
    this.ropeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ROPE.points * 3), 3));
    this.ropeGeo.setDrawRange(0, ROPE.points);
    this.ropeLine = new THREE.Line(this.ropeGeo, new THREE.LineBasicMaterial({ color: 0xd8d8d8 }));
    this.ropeLine.frustumCulled = false;
    this.scene.add(this.ropeLine);
    this.hookMesh = new THREE.Mesh(
      new THREE.SphereGeometry(ROPE.hookRadius, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd23c }),
    );
    const hookRing = new THREE.Mesh(
      new THREE.TorusGeometry(ROPE.hookRadius * 1.5, 0.05, 6, 14),
      new THREE.MeshBasicMaterial({ color: 0xffd23c }),
    );
    this.hookMesh.add(hookRing);
    this.scene.add(this.hookMesh);

    // majáky: cílový kmen + odkládací plocha
    this.targetBeacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 30, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.scene.add(this.targetBeacon);
    this.dropBeacon = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 40, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.dropBeacon.position.set(WORLD.dropZone.x, this.world.dropCenter.y + 20, WORLD.dropZone.z);
    this.scene.add(this.dropBeacon);

    // env pro fyziku
    this.ropeEnv = {
      heightAt: (x, z) => this.world.heightAt(x, z),
      logCollide: (p, out, skip) => this.logField.collidePoint(p, out, skip),
      downwashAt: (p, out) => this.downwashAt(p, out),
    };
    this.flightEnv = {
      wind: this.wind,
      heightAt: (x, z) => this.world.heightAt(x, z),
      treesNear: (x, z, r) => this.world.treesNear(x, z, r),
      time: 0,
      mode: 'stabilized',
      turbulenceScale: 1,
      attachForce: new THREE.Vector3(),
      loadMass: 0,
    };

    this.controls = new Controls(this.renderer.domElement);
    this.controls.loadSettings();
    this.camRig = new CameraRig(this.controls.settings.fov, this.controls.settings.zoom);
    this.applyGraphics(); // kvalita + počet stromů z uložených nastavení
    this.camRig.hookCam = this.controls.settings.hookCam;
    // prach od rotorového proudění při přiblížení k zemi (17.7, minimální varianta)
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(240 * 3);
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color: 0xb9a98a, size: 0.5, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    this.dust.visible = false;
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
    this.hud = new Hud(document.getElementById('ui')!);
    this.hud.bindStart(this.controls.settings, this.mission.money, this.mission.shift, () => this.startGame());
    this.hud.bindSettingsPanel(this.controls.settings, () => { this.controls.saveSettings(); this.applyGraphics(); }, () => this.controls.saveSettings());

    // déšť pro bouřku (skrytý dokud není zapnutá)
    const rainGeo = new THREE.BufferGeometry();
    const rainPos = new Float32Array(WEATHER.storm.rainCount * 3);
    for (let i = 0; i < WEATHER.storm.rainCount; i++) {
      rainPos[i * 3] = (Math.random() - 0.5) * 120;
      rainPos[i * 3 + 1] = Math.random() * 60;
      rainPos[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    this.rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
      color: 0x9fb8cc, size: 0.14, transparent: true, opacity: 0.55, sizeAttenuation: true, depthWrite: false,
    }));
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
    console.info(`[rotor-logger] model vrtulníku: ${this.heliModel.triCount} trojúhelníků (limit ${RENDER.heliMaxTris})`);
    this.hud.onNextShift = () => {
      this.mission.nextShift(this.logField);
      this.hud.showReport(null);
    };
    this.controls.onFirstGesture = () => this.sound.start();

    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.setPaused(true);
    });

    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // rotorové proudění pod vrtulníkem (7.2): zrychlení dolů, slábne se vzdáleností
  private downwashAt(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const hub = this.heli.hubPos(this.tmpV3);
    const dx = p.x - hub.x;
    const dz = p.z - hub.z;
    const below = hub.y - p.y;
    const R = this.heliType.rotorDiameter / 2;
    if (below <= 0 || below > R * 4 || Math.hypot(dx, dz) > R * 1.6) return out.set(0, 0, 0);
    const w = this.heli.telemetry.inducedMs * 2; // rychlost proudu pod diskem ~ 2·v_i
    const fall = Math.exp(-below / (R * 0.9)) * clamp(1 - Math.hypot(dx, dz) / (R * 1.6), 0, 1);
    return out.set(0, -ROPE.downwashGain * w * w * 0.02 * fall, 0);
  }

  private startGame(): void {
    this.sound.start();
    this.sound.setMuted(this.controls.settings.muted);
    this.hud.hideStart();
    this.state = 'playing';
    this.hud.message('Studený start: klávesa E — startér → zážeh → náběh rotoru', 5000);
  }

  private setPaused(p: boolean): void {
    if (this.state === 'playing' && p) {
      this.state = 'paused';
      this.hud.showPause(true);
    } else if (this.state === 'paused' && !p) {
      this.state = 'playing';
      this.hud.showPause(false);
      this.lastTime = performance.now();
    }
  }

  // aplikace grafických nastavení (17.5): kvalita + počet stromů
  private applyGraphics(rebuildTrees = true): void {
    const s = this.controls.settings;
    const preset = GRAPHICS.presets[s.graphicsQuality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
    this.renderer.shadowMap.enabled = preset.shadows;
    this.sun.castShadow = preset.shadows;
    if (preset.shadows) {
      this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      const old = this.sun.shadow.map;
      if (old) { old.dispose(); (this.sun.shadow as unknown as { map: unknown }).map = null; }
    }
    this.fogFarMul = preset.fogFarMul;
    if (rebuildTrees) this.world.buildTrees(this.scene, s.treeCount);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------------ frame
  private frame(): void {
    const now = performance.now();
    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    frameDt = Math.min(frameDt, 0.1);
    this.fps = lerp(this.fps, 1 / Math.max(frameDt, 1e-4), 0.05);

    const input = this.controls.output(frameDt);
    // globální klávesy
    if (input.helpPressed) this.showHelp = !this.showHelp;
    if (input.telemetryPressed) this.showTelemetry = !this.showTelemetry;
    if (input.mutePressed) {
      this.controls.settings.muted = !this.controls.settings.muted;
      this.sound.setMuted(this.controls.settings.muted);
      this.controls.saveSettings();
    }
    if (input.cameraViewPressed) this.camRig.cycleView(CAMERA.views);
    // hook cam (H): hlavní → obraz v obrazu → celá obrazovka → hlavní (6.5d, pamatuje si režim)
    if (input.hookCamPressed) {
      this.camRig.cycleHookCam();
      this.controls.settings.hookCam = this.camRig.hookCam;
      this.controls.saveSettings();
      this.hud.message(this.camRig.hookCam === 'pip' ? 'Hook cam: obraz v obrazu' : this.camRig.hookCam === 'full' ? 'Hook cam: celá obrazovka' : 'Hook cam: vypnuto', 1500);
    }
    // zoom kamery (6.5a): +/- nebo kolečko při volném rozhledu (pravé tlačítko)
    {
      const s = this.controls.settings;
      const dz = (input.zoomIn ? 12 * frameDt : 0) - (input.zoomOut ? 12 * frameDt : 0) + input.zoomWheel * 6;
      if (dz !== 0) {
        s.zoom = clamp(s.zoom + dz, CAMERA.zoomMin, CAMERA.zoomMax);
      }
    }
    // panel nastavení (O) — při otevření se fyzika zastaví
    if (input.settingsPressed) {
      this.settingsOpen = !this.settingsOpen;
      this.hud.showSettings(this.settingsOpen);
    }
    if (this.settingsOpen && input.pausePressed) {
      this.settingsOpen = false;
      this.hud.showSettings(false);
    }
    // cyklus letových režimů (P)
    if (input.modeCyclePressed) {
      const s = this.controls.settings;
      const i = FLIGHT_MODES.indexOf(s.mode);
      s.mode = FLIGHT_MODES[(i + 1) % FLIGHT_MODES.length];
      this.controls.saveSettings();
      this.hud.message(`Režim: ${MODE_LABELS[s.mode]}`, 2000);
    }
    if (this.settingsOpen) {
      this.updateEnvironment(frameDt);
      this.render(0);
      return;
    }
    if (input.savePressed) {
      this.mission.save();
      this.controls.saveSettings();
      this.hud.message('Uloženo (F5)', 2000);
    }
    if (this.state === 'paused') {
      if (input.pausePressed) this.setPaused(false);
      this.render(0);
      return;
    }
    if (input.pausePressed && this.state === 'playing') { this.setPaused(true); return; }
    if (this.state === 'menu') {
      // na start obrazovce kamera krouží kolem vrtulníku na heliportu
      const t = now / 1000;
      const r = 42;
      const hy = this.world.heightAt(WORLD.heliport.x, WORLD.heliport.z);
      this.camRig.reset();
      this.camera.position.set(WORLD.heliport.x + Math.cos(t * 0.12) * r, hy + 15, WORLD.heliport.z + Math.sin(t * 0.12) * r);
      this.camera.lookAt(WORLD.heliport.x, hy + 3, WORLD.heliport.z);
      this.updateEnvironment(frameDt);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // --- herní čas a počasí (nastavení: čas dne, vítr, bouřka) ---
    this.hour = (this.hour + (frameDt * 24) / (TIME.dayLengthMin * 60)) % 24;
    const s = this.controls.settings;
    const tod = s.timeOfDay;
    if (tod !== 'auto') this.hour = TIME_OF_DAY.hours[tod === 'day' ? 'day' : tod === 'dusk' ? 'dusk' : 'night'];
    const storm = s.storm;
    const windScale = WEATHER.windLevels[clamp(s.windLevel, 0, WEATHER.windLevels.length - 1)];
    const gust = (Math.sin(now / 1000 * WEATHER.gustFreq * Math.PI * 2) * 0.6 + Math.sin(now / 1000 * WEATHER.gustFreq * 2.7) * 0.4)
      * WEATHER.gustAmp * (storm ? WEATHER.storm.gustMultiplier : 1);
    this.wind.set((WEATHER.windBase.x + gust) * windScale, 0, (WEATHER.windBase.z + gust * 0.6) * windScale);
    if (storm && Math.random() < WEATHER.storm.lightningChancePerS * frameDt) this.lightningTimer = 0.14;
    this.flightEnv.time = now / 1000;
    this.flightEnv.mode = s.mode;
    // 17.3: bez větru se vůbec neklepe; ve větru lehce, v bouřce víc
    const windFactor = s.windLevel > 0 ? (storm ? WEATHER.storm.turbulenceMultiplier : 1) : 0;
    this.windFactor = windFactor;
    this.flightEnv.turbulenceScale = windFactor;
    this.stormActive = storm;
    if (s.testMode) this.showTelemetry = true;
    if (s.mode !== this.lastMode) {
      this.lastMode = s.mode;
      this.hud.setModeBadge(this.modeBadgeText());
    }

    // (režimy jen manual/stabilized — 17.6; alt-hold běží vždy, 6.3b)

    // --- akce hráče ---
    if (input.hookPressed) this.mission.hookPress(this.heli, this.rope, this.logField);
    if (input.nextShiftPressed && this.mission.report) this.hud.onNextShift?.();
    if (this.rope.broken && !this.wasRopeBroken) this.mission.onRopeBroken(this.rope);
    this.wasRopeBroken = this.rope.broken;

    // --- fixní fyzikální krok 120 Hz ---
    const h = PHYSICS.dt;
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= h && steps < 20) {
      this.accumulator -= h;
      steps++;
      this.snapshotPrev();
      // naviják + lano (horní konec z předchozí polohy — zpoždění 1 krok je zanedbatelné)
      this.rope.setLength(input.winch, h);
      this.rope.step(h, this.heli.attachPos(this.tmpV), this.ropeEnv);
      // zpětná vazba lana na vrtulník (7.6)
      this.flightEnv.attachForce.copy(this.rope.attachForceOnHeli(this.tmpV2));
      this.flightEnv.loadMass = this.rope.attached ? this.rope.attached.mass : 0;
      const fin: FlightInput = {
        targetPitch: input.targetPitch,
        targetRoll: input.targetRoll,
        pedal: input.pedal,
        collectiveRate: input.collectiveRate,
        engineStart: input.engineStart,
        engineCut: input.engineCut,
      };
      this.heli.step(fin, this.flightEnv, h);
      this.mission.update(h, this.heli, this.rope, this.logField);
    }
    if (steps === 20) this.accumulator = 0; // prevence spirály při zpomalení

    // crash → nouzový reset na heliport (bez tvrdého trestu)
    if (this.heli.crashed) {
      this.crashTimer += frameDt;
      if (this.crashTimer === frameDt) {
        this.hud.message(`Nouzové přistání: ${this.heli.crashReason}`, 4000);
        this.mission.onCrash();
        this.sound.blip(220, 0.4, 0.2);
      }
      if (this.crashTimer > 2.6) {
        const y = this.world.heightAt(WORLD.heliport.x, WORLD.heliport.z) + 2.7;
        this.heli.reset(WORLD.heliport.x, y, WORLD.heliport.z);
        this.rope.reset(this.heli.attachPos(new THREE.Vector3()));
        this.crashTimer = 0;
      }
    }

    this.updateEnvironment(frameDt);
    this.updateVisuals(frameDt);
    this.updateHud(input);
    this.sound.update(
      frameDt, this.heli.telemetry.omegaFrac, this.heliType.rotorBlades, this.heliType.rotorRpmNom,
      this.heli.telemetry.powerKw, this.heli.engine === 'running' || this.heli.engine === 'spoolup',
      this.heli.telemetry.airspeed, clamp(this.rope.tension / (this.heliType.hookMaxLoad * PHYSICS.gravity), 0, 2),
      this.rope.attached !== null,
    );

    const alpha = this.accumulator / h;
    this.render(alpha);
  }

  private snapshotPrev(): void {
    this.prev.pos.copy(this.heli.pos);
    this.prev.yaw = this.heli.yaw;
    this.prev.pitch = this.heli.pitch;
    this.prev.roll = this.heli.roll;
    this.prev.omega = this.heli.omega;
  }

  // ------------------------------------------------------------- prostředí
  private updateEnvironment(dt: number): void {
    // slunce: východ 6:00, západ 18:00, poledne 12:00
    const sunAngle = ((this.hour - 6) / 12) * Math.PI; // 0..2π přes den
    const elev = Math.sin(sunAngle) * (TIME.sunElevationDeg > 30 ? 62 : TIME.sunElevationDeg) * DEG;
    const azim = (this.hour / 24) * Math.PI * 2;
    let sunDir: THREE.Vector3;
    let dayFrac: number;
    if (elev > 0) {
      sunDir = new THREE.Vector3(Math.cos(azim) * Math.cos(elev), Math.sin(elev), Math.sin(azim) * Math.cos(elev)).normalize();
      dayFrac = clamp(Math.sin(elev) * 2.2, 0, 1);
    } else {
      // noc: měsíc zrcadlově
      const me = -Math.sin(sunAngle);
      sunDir = new THREE.Vector3(Math.cos(azim + Math.PI) * Math.cos(me), Math.sin(me), Math.sin(azim + Math.PI) * Math.cos(me)).normalize();
      dayFrac = 0;
    }
    void dt;
    this.skyMat.uniforms.sunDir.value.copy(sunDir);
    // barvy oblohy podle dne
    const dayTop = new THREE.Color(0x3a6ea8);
    const dayBot = new THREE.Color(0xc7d6e0);
    const duskTop = new THREE.Color(0x3a3a6e);
    const duskBot = new THREE.Color(0xff9a55);
    const nightTop = new THREE.Color(0x0b1424);
    const nightBot = new THREE.Color(0x1a2a3e); // 17.4: světlejší noc
    const duskFrac = clamp(1 - Math.abs(elev) / (18 * DEG), 0, 1); // soumrak kolem 0°
    const top = new THREE.Color().copy(nightTop).lerp(dayTop, dayFrac).lerp(duskTop, duskFrac * (1 - dayFrac) * 0.8);
    const bot = new THREE.Color().copy(nightBot).lerp(dayBot, dayFrac).lerp(duskBot, duskFrac * (1 - dayFrac) * 0.8);
    this.skyMat.uniforms.topColor.value.copy(top);
    this.skyMat.uniforms.bottomColor.value.copy(bot);
    this.skyMat.uniforms.sunColor.value.setHex(elev > 0 ? 0xffe0b0 : 0x8899bb);
    this.sun.color.setHex(elev > 0 ? 0xfff2dd : 0x8fa3cc);
    this.sun.intensity = elev > 0 ? 0.55 + 2.4 * dayFrac : 0.6; // 17.4: světlejší i v noci
    this.hemi.intensity = 0.38 + 0.62 * dayFrac; // 17.4: vyšší základní světlo
    this.hemi.color.setHex(elev > 0 ? 0xbfd4e6 : 0x2a3550);
    // stín follows heli
    const hp = this.heli.pos;
    this.sun.position.copy(hp).addScaledVector(sunDir, 320);
    this.sun.target.position.copy(hp);
    this.sun.target.updateMatrixWorld();
    // mlha podle denní doby (+ ztmavení při bouřce)
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(bot).lerp(new THREE.Color(0xffffff), dayFrac * 0.25);
    if (this.stormActive) fog.color.lerp(new THREE.Color(0x2a3038), WEATHER.storm.fogDarken);
    fog.near = RENDER.fogNear * (1 - dayFrac * 0.3);
    fog.far = RENDER.fogFar * this.fogFarMul * (1 - dayFrac * 0.35) * (this.stormActive ? 0.55 : 1);
    (this.stars.material as THREE.PointsMaterial).opacity = (1 - dayFrac) * 0.9 * (this.stormActive ? 0.2 : 1);
    this.nightFrac = 1 - dayFrac;
    // blesk: krátký záblesk světla
    if (this.lightningTimer > 0) {
      this.lightningTimer -= dt;
      this.sun.intensity *= WEATHER.storm.lightningBoost;
      this.hemi.intensity *= 1.8;
      this.skyMat.uniforms.sunColor.value.setHex(0xffffff);
    }
    this.renderer.setClearColor(fog.color);
  }

  // --------------------------------------------------------------- vizuál
  private modeBadgeText(): string {
    const s = this.controls.settings;
    const parts = [MODE_LABELS[s.mode] ?? s.mode];
    if (s.timeOfDay !== 'auto') parts.push(s.timeOfDay === 'day' ? 'den' : s.timeOfDay === 'dusk' ? 'soumrak' : 'noc');
    if (s.windLevel === 2) parts.push('silný vítr');
    else if (s.windLevel === 1) parts.push('mírný vítr');
    if (s.storm) parts.push('BOUŘKA');
    if (s.testMode) parts.push('test');
    return parts.join(' · ');
  }

  private updateVisuals(dt: number): void {
    // vrtulník (s interpolací mezi fyzikálními kroky se promítne v render())
    this.heliModel.update(dt, this.heli.omega, this.rope.winchRate, performance.now() / 1000, this.nightFrac);
    // vodní hladina mírně „dýchá“ (jemná animace)
    if (this.world.waterMesh) {
      (this.world.waterMesh.material as THREE.MeshPhongMaterial).opacity = 0.68 + Math.sin(performance.now() / 1400) * 0.05;
    }
    // déšť při bouřce: částice padají kolem kamery
    if (this.rain) {
      this.rain.visible = this.stormActive;
      if (this.stormActive) {
        this.rain.position.copy(this.camera.position);
        const pos = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          let y = pos.getY(i) - WEATHER.storm.rainSpeed * dt;
          if (y < 0) y += 60;
          pos.setY(i, y);
        }
        pos.needsUpdate = true;
      }
    }
    // lano jako čára mezi body
    const posAttr = this.ropeGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.rope.points.length; i++) {
      const p = this.rope.points[i];
      posAttr.setXYZ(i, p.x, p.y, p.z);
    }
    posAttr.needsUpdate = true;
    // zbarvení lana při vysokém napětí do oranžova (7.5)
    const tensionFrac = clamp(this.rope.tension / (this.heliType.hookMaxLoad * PHYSICS.gravity), 0, 1.6);
    (this.ropeLine.material as THREE.LineBasicMaterial).color.setRGB(0.85, lerp(0.85, 0.45, clamp(tensionFrac, 0, 1)), lerp(0.85, 0.1, clamp(tensionFrac, 0, 1)));
    // hák
    this.hookMesh.position.copy(this.rope.hookPos);
    const canPick = this.mission.pickupCandidate !== null && !this.rope.attached;
    const pulse = canPick ? 1 + Math.sin(performance.now() / 150) * 0.25 : 1;
    this.hookMesh.scale.setScalar(pulse);
    (this.hookMesh.material as THREE.MeshBasicMaterial).color.setHex(canPick ? 0x66ff66 : 0xffd23c);
    // maják cíle
    const target = this.rope.attached ? null : this.logField.nearestPending(this.heli.pos);
    if (target) {
      this.targetBeacon.visible = true;
      const p = target.attachPoint();
      this.targetBeacon.position.set(p.x, p.y + 15, p.z);
      (target.bodyMesh.material as THREE.MeshLambertMaterial).emissive = target.markColor.clone().multiplyScalar(0.55);
    } else {
      this.targetBeacon.visible = false;
    }
    for (const l of this.logField.logs) {
      if (l !== target) (l.bodyMesh.material as THREE.MeshLambertMaterial).emissive.setHex(0x000000);
    }
    this.dropBeacon.visible = this.rope.attached !== null;
    // kmen na laně: visí pod hákem, osa kmene podél lana (7.3)
    const log = this.rope.attached;
    if (log) {
      const hook = this.rope.hookPos;
      const dir = this.tmpV.copy(this.rope.points[0]).sub(hook);
      if (dir.lengthSq() > 1e-6) {
        dir.normalize(); // směr od nákladu k vrtulníku
        const local = this.tmpV2.set(log.length / 2 - 0.6, -0.1, 0).normalize(); // od úchytu ke středu kmene
        const qTarget = new THREE.Quaternion().setFromUnitVectors(local, dir.clone().negate());
        log.group.quaternion.slerp(qTarget, clamp(dt * 6, 0, 1));
        const attachLocal = new THREE.Vector3(-log.length / 2 + 0.6, 0.1, 0).applyQuaternion(log.group.quaternion);
        log.group.position.copy(hook).sub(attachLocal);
      }
    }
    // prach od rotorového proudění při přiblížení k zemi (17.7, minimální varianta)
    if (this.dust) {
      const agl = this.heli.telemetry.agl;
      const active = agl < 5 && this.heli.telemetry.omegaFrac > 0.7;
      this.dust.visible = active;
      if (active) {
        const pos = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
        const hub = this.heli.hubPos(this.tmpV3);
        for (let i = 0; i < pos.count; i++) {
          let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          const dx = x - hub.x, dz = z - hub.z;
          const d = Math.hypot(dx, dz) || 1;
          x += (dx / d) * 6 * dt + (Math.random() - 0.5) * 2 * dt;
          z += (dz / d) * 6 * dt + (Math.random() - 0.5) * 2 * dt;
          y -= 2.5 * dt;
          if (y < this.world.heightAt(x, z) + 0.2 || d > 14) {
            const a = Math.random() * Math.PI * 2;
            const r = (this.heliType.rotorDiameter / 2) * (0.5 + Math.random() * 0.5);
            x = hub.x + Math.cos(a) * r;
            z = hub.z + Math.sin(a) * r;
            y = hub.y - 1 - Math.random() * 2;
          }
          pos.setXYZ(i, x, y, z);
        }
        pos.needsUpdate = true;
      }
    }
  }

  private updateHud(input: ReturnType<Controls['output']>): void {
    const tel = this.heli.telemetry;
    const loadFrac = this.rope.attached ? this.rope.attached.mass / this.heliType.hookMaxLoad : (this.rope.tension / (this.heliType.hookMaxLoad * PHYSICS.gravity) * 0);
    // cíl: nejbližší kmen, nebo plocha při nákladu
    let bearing: number | null = null;
    let dist = 0;
    let label = '';
    if (this.rope.attached) {
      const c = this.world.dropCenter;
      const d = this.tmpV.set(c.x - this.heli.pos.x, 0, c.z - this.heli.pos.z);
      dist = d.length();
      bearing = wrapAngle(Math.atan2(-d.x, -d.z) - this.heli.yaw);
      label = 'odkládací plocha';
    } else {
      const t = this.logField.nearestPending(this.heli.pos);
      if (t) {
        const p = t.pos;
        const d = this.tmpV.set(p.x - this.heli.pos.x, 0, p.z - this.heli.pos.z);
        dist = d.length();
        bearing = wrapAngle(Math.atan2(-d.x, -d.z) - this.heli.yaw);
        label = `kmen #${t.id + 1}`;
      }
    }
    const warnings: string[] = [];
    if (tel.rotorLow) warnings.push('NÍZKÉ OTÁČKY ROTORU');
    if (tel.vrs) warnings.push('VÍROVÝ KRUH — přidej rychlost nebo klesni mělčeji');
    if (tel.retreating) warnings.push('ÚSTUP LISTU — vysoká rychlost');
    if (this.rope.attached && this.heli.totalMass * PHYSICS.gravity > tel.thrustN * 1.02) warnings.push('NEDOSTATEK VZTAKU — OSEDáš');
    if (this.rope.broken) warnings.push('LANO PŘETRŽENO');
    let prompt: string | null = null;
    if (this.mission.pickupCandidate && !this.rope.attached && !this.rope.broken) {
      prompt = `<span class="kbd">mezerník</span> zajisti chycení kmene #${this.mission.pickupCandidate.id + 1}`;
    } else if (this.rope.attached) {
      prompt = `<span class="kbd">mezerník</span> uvolnit náklad`;
    } else if (this.heli.engine === 'off') {
      prompt = `<span class="kbd">E</span> studený start motoru`;
    }
    const stickRadiusPx = Math.min(window.innerWidth, window.innerHeight) * CONTROLS.stickRadiusFrac;
    // napětí lana v % nosnosti háku (oddíl 10)
    const tensionFrac = clamp(this.rope.tension / (this.heliType.hookMaxLoad * PHYSICS.gravity), 0, 1.6);
    // hook cam info (6.5d): vzdálenost háku od cíle (kmen) nebo od země
    let hookInfo: string | null = null;
    if (this.camRig.hookCam !== 'off') {
      const hook = this.rope.hookPos;
      const groundH = this.world.heightAt(hook.x, hook.z);
      const cand = this.mission.pickupCandidate;
      if (cand && !this.rope.attached) {
        hookInfo = `hák → kmen #${cand.id + 1}: ${hook.distanceTo(cand.attachPoint()).toFixed(1)} m · nad zemí ${(hook.y - groundH).toFixed(1)} m`;
      } else {
        hookInfo = `hák nad zemí: ${(hook.y - groundH).toFixed(1)} m`;
      }
    }
    this.hud.update(
      tel, this.heli.collective, clamp(loadFrac, 0, 1.2), this.rope.length,
      this.controls.stickFiltered, stickRadiusPx, this.mission, bearing, dist, label,
      this.hour, (this.hour % 1) * 60, warnings, prompt, tensionFrac, hookInfo,
    );
    this.hud.setHelp(this.showHelp);
    this.hud.setModeBadge(this.modeBadgeText());
    if (this.showTelemetry) {
      const e = this.heli.energy();
      this.hud.setTelemetry(true, [
        `fps ${this.fps.toFixed(0)}  dt_fix ${PHYSICS.dt.toFixed(4)}s`,
        `pos ${this.heli.pos.x.toFixed(1)} ${this.heli.pos.y.toFixed(1)} ${this.heli.pos.z.toFixed(1)}`,
        `vel ${this.heli.vel.x.toFixed(1)} ${this.heli.vel.y.toFixed(1)} ${this.heli.vel.z.toFixed(1)} |V| ${tel.airspeed.toFixed(1)} m/s`,
        `yaw ${(this.heli.yaw / DEG).toFixed(0)}° pitch ${(this.heli.pitch / DEG).toFixed(1)}° roll ${(this.heli.roll / DEG).toFixed(1)}°`,
        `Ω ${(tel.omegaFrac * 100).toFixed(1)}%  T ${(tel.thrustN / 1000).toFixed(1)} kN  P ${(tel.powerKw).toFixed(0)} kW  v_i ${tel.inducedMs.toFixed(1)} m/s`,
        `AGL ${tel.agl.toFixed(1)} m  GE x${tel.groundEffect.toFixed(2)} ETL x${tel.etl.toFixed(2)} VRS ${tel.vrs} (x${tel.vrsFactor.toFixed(2)})`,
        `m ${(tel.totalMass).toFixed(0)} kg  E ${(e / 1e6).toFixed(2)} MJ  lano ${(this.rope.tension / 1000).toFixed(1)} kN len ${this.rope.length.toFixed(1)} m`,
        `motor ${this.heli.engine}  palivo ${this.heli.fuelKg.toFixed(0)} kg  money ${this.mission.money | 0}`,
      ].join('\n'));
    } else {
      this.hud.setTelemetry(false, '');
    }
    this.hud.showReport(this.mission.report);
    void input;
  }

  // ---------------------------------------------------------------- render
  private render(alpha: number): void {
    // interpolovaná pozice vrtulníku mezi fyzikálními kroky
    const p = this.tmpV.copy(this.prev.pos).lerp(this.heli.pos, alpha);
    const yaw = lerp(this.prev.yaw, this.heli.yaw, alpha);
    const pitch = lerp(this.prev.pitch, this.heli.pitch, alpha);
    const roll = lerp(this.prev.roll, this.heli.roll, alpha);
    this.heliModel.group.position.copy(p);
    // POZNÁMKA (5.4, revidováno): trup se NEkmitá — žádné vizuální chvění na modelu.
    // Jediné chvění je kamerové mikro-otřesy < 0,2° (níže v applyMicroShake).
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    this.heliModel.group.quaternion.copy(q);

    // kamera přes CameraRig (vyhlazení τ=0,3 s, volný rozhled, kolize, roll 25 %)
    const s = this.controls.settings;
    if (Math.abs(this.camera.fov - s.fov) > 0.01) {
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camRig.zoom = s.zoom;
    const freeLook = this.controls.freeLookHeld();
    if (freeLook) this.camRig.freeLook(this.controls.consumeFreeDelta());
    else this.controls.consumeFreeDelta();
    this.camRig.update(1 / 60, p, q, freeLook, this.world, this.camera, this.heli.telemetry.horizSpeed);
    // kamerové mikro-otřesy jen ve větru (17.3), max 0,2°
    this.camRig.applyMicroShake(this.camera, this.heli.telemetry.omegaFrac * this.windFactor);

    // hlavní render (nebo celá obrazovka hook cam)
    if (this.camRig.hookCam === 'full') {
      this.camRig.updateHookCam(p, q, this.rope.hookPos, s.fov);
      this.camRig.hookCamera.aspect = window.innerWidth / window.innerHeight;
      this.camRig.hookCamera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camRig.hookCamera);
    } else {
      this.renderer.render(this.scene, this.camera);
      // hook cam jako obraz v obrazu v PRAVÉM HORNÍM rohu (17.2) — pohled z kamery na helikoptéře dolů na lano
      if (this.camRig.hookCam === 'pip') {
        const w = Math.floor(window.innerWidth * CAMERA.hookCamPipFrac);
        const h = Math.floor(w * 9 / 16);
        const x = window.innerWidth - w - 16;
        const y = window.innerHeight - h - 16; // WebGL viewport počítá odspoda
        this.camRig.updateHookCam(p, q, this.rope.hookPos, s.fov);
        this.camRig.hookCamera.aspect = w / h;
        this.camRig.hookCamera.updateProjectionMatrix();
        this.renderer.setScissorTest(true);
        this.renderer.setViewport(x, y, w, h);
        this.renderer.setScissor(x, y, w, h);
        this.renderer.render(this.scene, this.camRig.hookCamera);
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      }
    }
  }
}

const game = new Game();
// ladicí přístup pro smoke testy (headless) — nepoužívá se ve hře
(window as unknown as { __rotorLogger: Game }).__rotorLogger = game;
