// ============================================================================
// Ovládání (oddíl 6): „stíhačkové“ myší řízení jako v War Thunder / DCS.
// Myš není kurzor — její VZDÁLENOST OD STŘEDU obrazovky je proporcionální
// výchylka virtuální páky (kritéria 6.7a–d). Klávesy: kolektiv W/S, pedály A/D.
// ============================================================================

import { CONTROLS, GAMEPLAY, SETTINGS_DEFAULTS, type TimeOfDayPreset, type FlightMode, type HookCamMode } from '../config';
import { clamp, expoCurve, deadZone, DEG, damp } from '../utils/math';

export interface ControlSettings {
  invertY: boolean;
  expo: number;
  sensitivity: number;
  stickSmoothing: number;       // τ dolnopropustního filtru páky [s] (6.2b)
  fov: number;                  // FOV kamery
  zoom: number;                 // vzdálenost chase kamery [m]
  hookCam: HookCamMode;         // off / pip / full (6.5d)
  muted: boolean;
  timeOfDay: TimeOfDayPreset;  // den/noc/soumrak/auto cyklus
  windLevel: number;            // index do WEATHER.windLevels
  storm: boolean;               // bouřka
  testMode: boolean;            // test režim (telemetrie, výpadek motoru)
  mode: FlightMode;             // manual / stabilized / hover / autopilot
}

export interface ControlOutput {
  targetPitch: number;   // rad, + příď nahoru
  targetRoll: number;    // rad, + náklon doprava
  pedal: number;         // +1 = doleva
  collectiveRate: number;// -1..1
  winch: number;         // -1 zatahovat, +1 vysouvat, 0 držet
  hookPressed: boolean;
  engineStart: boolean;
  engineCut: boolean;
  trimPressed: boolean;
  cameraViewPressed: boolean;
  hookCamPressed: boolean;      // H — pohled na naviják (6.5d)
  zoomIn: boolean;
  zoomOut: boolean;
  zoomWheel: number;            // kolečko při volném rozhledu = zoom (6.5a)
  mutePressed: boolean;
  helpPressed: boolean;
  telemetryPressed: boolean;
  savePressed: boolean;
  pausePressed: boolean;
  nextShiftPressed: boolean;
  settingsPressed: boolean;   // O — panel nastavení
  modeCyclePressed: boolean;  // P — cyklus letových režimů
  anyKey: boolean;
}

// Čisté mapování výchylky virtuální páky na normalizované výstupy (testovatelné).
// Proporcionalita: při expo 0 je výstup přesně roven vstupu (kritérium 6.7a).
export function mapStick(
  sx: number, sy: number,
  s: { expo: number; sensitivity: number; invertY: boolean },
): { x: number; y: number } {
  let ax = clamp(sx * s.sensitivity, -1, 1);
  let ay = clamp(sy * s.sensitivity, -1, 1);
  ax = clamp(expoCurve(deadZone(ax, CONTROLS.deadZone), s.expo, CONTROLS.expoCurve), -1, 1);
  ay = clamp(expoCurve(deadZone(ay, CONTROLS.deadZone), s.expo, CONTROLS.expoCurve), -1, 1);
  if (s.invertY) ay = -ay;
  return { x: ax, y: ay };
}

export class Controls {
  settings: ControlSettings = { ...SETTINGS_DEFAULTS };
  // virtuální páka: x doprava, y nahoru, obojí v [-1, 1]
  stick = { x: 0, y: 0 };
  // filtrovaná poloha páky (dolnopropustní, τ = stickSmoothing) — do ní jde surová
  // poloha; HUD ukazuje právě tuto filtrovanou hodnotu (6.2b, 10)
  stickFiltered = { x: 0, y: 0 };
  trim = { x: 0, y: 0 };
  private prevTarget = { pitch: 0, roll: 0 }; // pro limit rychlosti změny cíle (6.2b)
  private keysDown = new Set<string>();
  private pressed = new Set<string>(); // stisknuto v tomto snímku
  private canvas: HTMLElement;
  private pointerLocked = false;
  private wheelCollective = 0;
  private wheelWinch = 0;
  private wheelZoom = 0;
  private lockedAccum = { x: 0, y: 0 };
  // při držení pravého tlačítka se myš věnuje volnému rozhledu místo páce
  readonly freeDelta = { x: 0, y: 0 };
  onFirstGesture: (() => void) | null = null;
  private gestureDone = false;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keysDown.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.fireGesture();
    });
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.code));
    window.addEventListener('blur', () => this.keysDown.clear());
    canvas.addEventListener('mousedown', (e) => {
      this.fireGesture();
      if (e.button === 2) { this.keysDown.add('__rmb__'); return; } // volný rozhled při držení
      if (!this.pointerLocked) {
        canvas.requestPointerLock?.();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.keysDown.delete('__rmb__');
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) this.lockedAccum.x = this.lockedAccum.y = 0;
    });
    document.addEventListener('mousemove', (e) => {
      this.fireGesture();
      if (this.pointerLocked) {
        if (this.keysDown.has('__rmb__')) {
          this.freeDelta.x += e.movementX;
          this.freeDelta.y += e.movementY;
          return;
        }
        const r = this.stickRadiusPx();
        this.lockedAccum.x = clamp(this.lockedAccum.x + e.movementX / r, -1, 1);
        this.lockedAccum.y = clamp(this.lockedAccum.y - e.movementY / r, -1, 1); // myš nahoru = +y
        this.applyStick(this.lockedAccum.x, this.lockedAccum.y);
      } else {
        const rect = this.canvas.getBoundingClientRect();
        const r = this.stickRadiusPx();
        const mx = (e.clientX - (rect.left + rect.width / 2)) / r;
        const my = -((e.clientY - (rect.top + rect.height / 2)) / r);
        this.applyStick(clamp(mx, -1, 1), clamp(my, -1, 1));
      }
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = e.deltaY < 0 ? 0.06 : -0.06;
      if (this.keysDown.has('__rmb__')) {
        // při volném rozhledu kolečko zoomuje kameru (6.5a)
        this.wheelZoom = clamp(this.wheelZoom + step * 2, -1, 1);
      } else if (e.shiftKey && GAMEPLAY.wheelWinchWithShift) {
        this.wheelWinch = clamp(this.wheelWinch + step, -1, 1); // Shift + kolečko = naviják
      } else {
        this.wheelCollective = clamp(this.wheelCollective + step, -1, 1);
      }
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private fireGesture(): void {
    if (!this.gestureDone) {
      this.gestureDone = true;
      this.onFirstGesture?.();
    }
  }

  private stickRadiusPx(): number {
    return Math.min(window.innerWidth, window.innerHeight) * CONTROLS.stickRadiusFrac;
  }

  private applyStick(x: number, y: number): void {
    // kruhové omezení, aby diagonála nepřesáhla 1
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.stick.x = x;
    this.stick.y = y;
  }

  // Načte nastavení z localStorage (uložení mezi sezeními).
  loadSettings(): void {
    try {
      const raw = localStorage.getItem('rotor-logger-settings-v1');
      if (raw) Object.assign(this.settings, JSON.parse(raw));
    } catch { /* ignorovat poškozené uložiště */ }
  }

  saveSettings(): void {
    try {
      localStorage.setItem('rotor-logger-settings-v1', JSON.stringify(this.settings));
    } catch { /* ignorovat */ }
  }

  private anyPressed(codes: readonly string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  private isDown(codes: readonly string[]): boolean {
    return codes.some((c) => this.keysDown.has(c));
  }

  // Vrací výstup pro tento snímek; musí se volat jednou za frame (s frame dt).
  output(dt: number): ControlOutput {
    const s = this.settings;
    const K = CONTROLS.keys;
    // 6.2b: surová poloha páky přes dolnopropustní filtr (τ) — cuknutí myši se nedostane dál
    const tau = Math.max(0.01, s.stickSmoothing || CONTROLS.stickSmoothingDefault);
    this.stickFiltered.x = damp(this.stickFiltered.x, this.stick.x, 1 / tau, dt);
    this.stickFiltered.y = damp(this.stickFiltered.y, this.stick.y, 1 / tau, dt);
    // výchylka páky po trimu → mrtvá zóna, expo křivka, citlivost (6.1)
    const mapped = mapStick(
      clamp(this.stickFiltered.x - this.trim.x, -1, 1),
      clamp(this.stickFiltered.y - this.trim.y, -1, 1),
      s,
    );
    const sx = mapped.x;
    const sy = mapped.y;
    // proporcionální mapování (6.1): target úhel = výchylka · max úhel
    let targetPitch = -sy * CONTROLS.maxPitchDeg * DEG; // myš nahoru = příď dolů (stíhačky)
    let targetRoll = sx * CONTROLS.maxRollDeg * DEG;    // myš doprava = náklon doprava
    // 6.2b: limit rychlosti změny cílového náklonu (žádné trhavé cukání)
    const maxRate = CONTROLS.targetRateLimitDegS * DEG * dt;
    targetPitch = this.prevTarget.pitch + clamp(targetPitch - this.prevTarget.pitch, -maxRate, maxRate);
    targetRoll = this.prevTarget.roll + clamp(targetRoll - this.prevTarget.roll, -maxRate, maxRate);
    this.prevTarget.pitch = targetPitch;
    this.prevTarget.roll = targetRoll;

    const collectiveRate =
      (this.isDown(K.collectiveUp) ? 1 : 0) + (this.isDown(K.collectiveDown) ? -1 : 0) + this.wheelCollective;
    this.wheelCollective *= 0.9; // kolečko myši je impulzní

    const pedal = (this.isDown(K.pedalLeft) || this.isDown(K.pedalLeftAlt) ? 1 : 0)
      + (this.isDown(K.pedalRight) || this.isDown(K.pedalRightAlt) ? -1 : 0);

    const winch = (this.isDown(K.winchOut) ? 1 : 0) + (this.isDown(K.winchIn) ? -1 : 0) + this.wheelWinch;
    this.wheelWinch *= 0.9; // kolečko je impulzní

    const out: ControlOutput = {
      targetPitch,
      targetRoll,
      pedal,
      collectiveRate: clamp(collectiveRate, -1, 1),
      winch,
      hookPressed: this.anyPressed(K.hook),
      engineStart: this.anyPressed(K.engine),
      engineCut: this.anyPressed(K.engineCutTest),
      trimPressed: this.anyPressed(K.trim),
      cameraViewPressed: this.anyPressed(K.cameraView),
      hookCamPressed: this.anyPressed(K.hookCam),
      zoomIn: this.isDown(K.zoomIn),
      zoomOut: this.isDown(K.zoomOut),
      zoomWheel: this.wheelZoom,
      mutePressed: this.anyPressed(K.mute),
      helpPressed: this.anyPressed(K.help),
      telemetryPressed: this.anyPressed(K.telemetry),
      savePressed: this.anyPressed(K.quickSave),
      pausePressed: this.anyPressed(K.pause),
      nextShiftPressed: this.anyPressed(K.nextShift),
      settingsPressed: this.anyPressed(K.settings),
      modeCyclePressed: this.anyPressed(K.modeCycle),
      anyKey: this.pressed.size > 0,
    };
    // trim (C): aktuální výchylka myši se stane novým nulovým bodem
    if (out.trimPressed) {
      this.trim.x = clamp(this.trim.x + this.stick.x, -0.6, 0.6);
      this.trim.y = clamp(this.trim.y + this.stick.y, -0.6, 0.6);
    }
    this.pressed.clear();
    this.wheelZoom *= 0.85;
    return out;
  }

  // Pravé tlačítko myši drženo = volný rozhled (kamera se nedívá za vrtulník).
  freeLookHeld(): boolean {
    return this.keysDown.has('__rmb__');
  }

  consumeFreeDelta(): { x: number; y: number } {
    const d = { x: this.freeDelta.x, y: this.freeDelta.y };
    this.freeDelta.x = 0;
    this.freeDelta.y = 0;
    return d;
  }
}
