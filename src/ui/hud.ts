// ============================================================================
// HUD a UI (oddíl 10): minimální čitelný panel vpravo dole (NR %, kolektiv %,
// výška nad terénem, rychlost, zatížení navijáku), horní proužek s cílem a
// kompasovou značkou, radiogramy dispečera, výzvy, překryvy (start, nápověda,
// telemetrie, pilotní poznámky). Vše DOM + malé SVG ikony, žádné textury.
// ============================================================================

import type { FlightTelemetry } from '../helicopter/flightModel';
import type { Mission, ShiftReport } from '../game/mission';
import type { ControlSettings } from '../helicopter/controls';

const ICONS = {
  rotor: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v7M12 15v7M2 12h7M15 12h7M5 5l5 5M14 14l5 5M19 5l-5 5M10 14l-5 5"/></svg>',
  collective: '<svg viewBox="0 0 24 24"><path d="M12 3v18M7 8l5-5 5 5"/></svg>',
  altitude: '<svg viewBox="0 0 24 24"><path d="M3 20h18M12 4l4 6H8l4-6zM12 10v10"/></svg>',
  speed: '<svg viewBox="0 0 24 24"><path d="M4 14a8 8 0 1 1 16 0M12 14l4-5"/></svg>',
  load: '<svg viewBox="0 0 24 24"><path d="M12 3v6M6 9h12l-2 11H8L6 9z"/></svg>',
  rope: '<svg viewBox="0 0 24 24"><path d="M6 3c6 3-6 6 0 9s-6 6 0 9M18 3c-6 3 6 6 0 9s6 6 0 9"/></svg>',
};

export class Hud {
  private root: HTMLElement;
  private el!: Record<string, HTMLElement>;

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
  }

  private build(): void {
    const ui = this.root;
    ui.innerHTML = `
      <div id="stats" class="panel">
        <div class="row"><span class="label">${ICONS.rotor} NR</span><span class="value" id="nr">0 %</span></div>
        <div class="row"><span class="label">${ICONS.collective} kolektiv</span><span class="value" id="coll">0 %</span></div>
        <div class="row"><span class="label">${ICONS.altitude} nad terénem</span><span class="value" id="agl">–</span></div>
        <div class="row"><span class="label">${ICONS.speed} rychlost</span><span class="value" id="spd">0 m/s</span></div>
        <div class="row"><span class="label">${ICONS.load} náklad</span><span class="value" id="load">0 %</span></div>
        <div class="row"><span class="label">${ICONS.rope} lano</span><span class="value" id="rope">3 m</span></div>
        <div class="row"><span class="label">napětí lana</span><span class="value" id="tension">0 %</span></div>
        <div class="row"><span class="label">${ICONS.altitude} držení výšky</span><span class="value" id="althold" style="color:#666;">—</span></div>
        <div style="grid-column: 1 / span 2; color: var(--dim); font-size: 11px; margin-top: 4px;">lano: <span class="kbd">R</span>/<span class="kbd">V</span> nebo <span class="kbd">Shift</span>+kolečko · hák: <span class="kbd">mezerník</span> · hook cam: <span class="kbd">H</span> · nastavení: <span class="kbd">O</span> · režim: <span class="kbd">P</span></div>
      </div>
      <div id="hookInfo" class="panel" style="position:absolute; right:18px; top:215px; padding:8px 14px; font-size:13px; display:none;"></div>
      <div id="topbar-left">
        <div id="target" class="panel">
          <svg id="targetArrow" viewBox="0 0 24 24"><path d="M12 2l6 18-6-4-6 4z"/></svg>
          <span id="targetText">—</span>
        </div>
        <div id="modeBadge" class="panel" style="padding:8px 14px; font-size:12px; font-weight:700; color:var(--accent);">STABILIZOVANÝ</div>
        <div id="clock" class="panel" style="padding:8px 14px;">18:24</div>
      </div>
      <div id="radio"></div>
      <div id="prompt" class="panel"></div>
      <div id="reticle"></div>
      <div id="stickDot"></div>
      <div id="stickRing"></div>
      <div id="warnings"></div>
      <div id="msg"></div>
      <div id="telemetry" class="panel"></div>
      <div id="help" class="panel"></div>

      <div id="startOverlay" class="overlay">
        <div class="card panel">
          <h1>ROTOR <span>LOGGER</span></h1>
          <p class="dim">Klidný večerní letový simulátor — vrtulníková těžba dřeva. Převážej pokácené kmeny
          z těžební oblasti na odkládací plochu (vlaječka) pomocí podvěšeného navijáku.</p>
          <div class="controls-grid">
            <span class="k">myš = cyklika (vzdálenost od středu = náklon)</span><span>W/S kolektiv · A/D pedály</span>
            <span class="k">R/V naviják (vysunout/zatáhnout)</span><span>mezerník hák (chytit/pustit)</span>
            <span class="k">E studený start motoru · T test výpadku</span><span>C trim · X kamera · pravé tlačítko rozhled</span>
            <span class="k">F1 nápověda · F3 telemetrie · F5 uložit · M zvuk</span><span>G Assist/Real</span>
          </div>
          <div class="settings">
            <label><input type="checkbox" id="setInvertY" /> invertovat myš Y</label>
            <label>expo <input type="range" id="setExpo" min="0" max="0.5" step="0.05" /></label>
            <label>citlivost <input type="range" id="setSens" min="0.4" max="2" step="0.05" /></label>
          </div>
          <p class="dim" id="saveInfo"></p>
          <button id="startBtn">Nastoupit do stroje</button>
        </div>
      </div>

      <div id="reportOverlay" class="overlay hidden">
        <div class="card panel" id="report"></div>
      </div>

      <div id="pauseOverlay" class="overlay hidden">
        <div class="card panel">
          <h2>Pauza</h2>
          <p class="dim">Esc — zpět do hry. Nastavení se ukládají automaticky.</p>
          <button id="resumeBtn">Pokračovat</button>
          <button id="openSettingsBtn" class="secondary">Nastavení (O)</button>
        </div>
      </div>

      <div id="settingsOverlay" class="overlay hidden">
        <div class="card panel">
          <h2>Nastavení</h2>
          <div class="settings" style="flex-direction: column; align-items: stretch; gap: 12px;">
            <label style="justify-content: space-between;">Čas dne
              <select id="setTime">
                <option value="auto">Auto (cyklus dne)</option>
                <option value="day">Den</option>
                <option value="dusk">Večer/soumrak</option>
                <option value="night">Noc</option>
              </select>
            </label>
            <label style="justify-content: space-between;">Vítr
              <select id="setWind">
                <option value="0">Bez větru</option>
                <option value="1">Mírný</option>
                <option value="2">Silný</option>
              </select>
            </label>
            <label><input type="checkbox" id="setStorm" /> Bouřka (poryvy, liják, blesky)</label>
            <label><input type="checkbox" id="setTest" /> Test režim (telemetrie F3, výpadek motoru T)</label>
            <label style="justify-content: space-between;">Režim letu (17.6: jen dva)
              <select id="setMode">
                <option value="stabilized">Stabilizovaný</option>
                <option value="manual">Manual (plný realismus)</option>
              </select>
            </label>
            <label style="justify-content: space-between;">Kvalita grafiky
              <select id="setQuality">
                <option value="low">Nízká (bez stínů)</option>
                <option value="medium">Střední</option>
                <option value="high">Vysoká</option>
              </select>
            </label>
            <label style="justify-content: space-between;">Počet stromů: <span id="treeCountLabel">9000</span>
              <input type="range" id="setTrees" min="2000" max="12000" step="500" /></label>
            <label style="justify-content: space-between;">Vyhlazení joysticku (τ)
              <input type="range" id="setSmooth" min="0.02" max="0.3" step="0.01" /></label>
            <label style="justify-content: space-between;">FOV kamery
              <input type="range" id="setFov" min="40" max="90" step="1" /></label>
            <label style="justify-content: space-between;">Zoom kamery
              <input type="range" id="setZoom" min="8" max="30" step="1" /></label>
          </div>
          <p class="dim">Režim letu lze rychle cyklovat klávesou <span class="kbd">P</span>. Nastavení se ukládají automaticky.</p>
          <button id="closeSettingsBtn">Zavřít (O)</button>
        </div>
      </div>
    `;
    const ids = ['stats', 'nr', 'coll', 'agl', 'spd', 'load', 'rope', 'tension', 'althold', 'hookInfo', 'target', 'targetArrow', 'targetText', 'clock',
      'radio', 'prompt', 'reticle', 'stickDot', 'stickRing', 'warnings', 'msg', 'telemetry', 'help',
      'startOverlay', 'reportOverlay', 'report', 'pauseOverlay', 'startBtn', 'resumeBtn', 'saveInfo',
      'setInvertY', 'setExpo', 'setSens', 'modeBadge',
      'settingsOverlay', 'setTime', 'setWind', 'setStorm', 'setTest', 'setMode', 'closeSettingsBtn', 'openSettingsBtn',
      'setSmooth', 'setFov', 'setZoom', 'setQuality', 'setTrees', 'treeCountLabel'];
    this.el = {};
    for (const id of ids) this.el[id] = ui.querySelector('#' + id) as HTMLElement;
    this.buildHelp();
  }

  private buildHelp(): void {
    this.el.help.innerHTML = `
      <b>Nápověda (F1)</b><br>
      <span class="kbd">myš</span> cyklika — čím dál od středu, tím větší náklon<br>
      <span class="kbd">W</span>/<span class="kbd">S</span> kolektiv (více/méně vztlaku), kolečko myši<br>
      <span class="kbd">A</span>/<span class="kbd">D</span> pedály (Q/E), <span class="kbd">C</span> trim<br>
      <span class="kbd">R</span>/<span class="kbd">V</span> naviják vysunout/zatáhnout (max 40 m), <span class="kbd">Shift</span>+kolečko také<br>
      <span class="kbd">mezerník</span> zajistit/uvolnit hák u kmene<br>
      <span class="kbd">E</span> start/vypnutí motoru, <span class="kbd">T</span> test výpadku<br>
      <span class="kbd">X</span> přepnout kameru, <span class="kbd">H</span> pohled na naviják (PiP/celá obrazovka), <span class="kbd">+</span>/<span class="kbd">−</span> zoom<br>
      držet <span class="kbd">Pravé tlačítko</span> = volný rozhled (kolečko pak zoomuje), joystick drží poslední polohu<br>
      <span class="kbd">F3</span> telemetrie, <span class="kbd">F5</span> uložit, <span class="kbd">M</span> zvuk<br>
      <span class="kbd">O</span> nastavení (čas dne, vítr, bouřka, test, režim letu), <span class="kbd">P</span> režim letu<br>
      <span class="kbd">Esc</span> pauza`;
  }

  bindStart(settings: ControlSettings, money: number, shift: number, onStart: () => void): void {
    const invert = this.el.setInvertY as HTMLInputElement;
    const expo = this.el.setExpo as HTMLInputElement;
    const sens = this.el.setSens as HTMLInputElement;
    invert.checked = settings.invertY;
    expo.value = String(settings.expo);
    sens.value = String(settings.sensitivity);
    this.el.saveInfo.textContent = money > 0 ? `Uloženo: ${Math.round(money)} Kč, směna č. ${shift}` : 'Nová hra — seed světa v config.ts.';
    const sync = () => {
      settings.invertY = invert.checked;
      settings.expo = parseFloat(expo.value);
      settings.sensitivity = parseFloat(sens.value);
    };
    for (const el of [invert, expo, sens]) el.addEventListener('input', sync);
    this.el.startBtn.addEventListener('click', () => {
      sync();
      onStart();
    });
    this.el.resumeBtn.addEventListener('click', () => this.showPause(false));
  }

  hideStart(): void {
    this.el.startOverlay.classList.add('hidden');
  }

  showPause(v: boolean): void {
    this.el.pauseOverlay.classList.toggle('hidden', !v);
  }

  setRunning(v: boolean): void {
    this.el.startOverlay.classList.toggle('hidden', v);
  }

  update(
    tel: FlightTelemetry,
    collective: number,
    loadFrac: number,
    ropeLen: number,
    stick: { x: number; y: number },
    stickRadiusPx: number,
    mission: Mission,
    targetBearing: number | null,
    targetDist: number,
    targetLabel: string,
    hour: number,
    minute: number,
    warnings: string[],
    prompt: string | null,
    tensionFrac = 0,
    hookInfo: string | null = null,
  ): void {
    const nr = tel.omegaFrac * 100;
    const nrEl = this.el.nr;
    nrEl.textContent = `${nr.toFixed(0)} %`;
    nrEl.classList.toggle('warn', tel.rotorLow);
    this.el.coll.textContent = `${Math.round(collective * 100)} %`;
    this.el.agl.textContent = `${tel.agl.toFixed(1)} m`;
    this.el.spd.textContent = `${tel.airspeed.toFixed(0)} m/s`;
    this.el.load.textContent = `${Math.round(loadFrac * 100)} %`;
    this.el.rope.textContent = `${ropeLen.toFixed(1)} m`;
    this.el.tension.textContent = `${Math.round(tensionFrac * 100)} %`;
    const ah = this.el.althold;
    ah.textContent = tel.altHold ? 'DRŽÍ' : '—';
    ah.style.color = tel.altHold ? '#7dff9a' : '#666';
    const hi = this.el.hookInfo;
    if (hookInfo) { hi.style.display = 'block'; hi.textContent = hookInfo; } else hi.style.display = 'none';

    // cíl + kompasová značka
    const arrow = this.el.targetArrow as unknown as SVGElement;
    if (targetBearing === null) {
      this.el.targetText.textContent = '—';
      arrow.style.transform = 'rotate(0deg)';
    } else {
      arrow.style.transform = `rotate(${(-targetBearing * 180 / Math.PI).toFixed(1)}deg)`;
      this.el.targetText.textContent = `${targetLabel} · ${targetDist.toFixed(0)} m`;
    }
    this.el.clock.textContent = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor(minute)).padStart(2, '0')}`;

    // radiogramy
    const radio = this.el.radio;
    const msgs = mission.radio.slice(-3);
    radio.innerHTML = msgs.map((m) => `<div class="radio-msg panel"><span class="who">Věž</span><br>${m.text}</div>`).join('');

    // výzva
    const p = this.el.prompt;
    if (prompt) { p.style.display = 'block'; p.innerHTML = prompt; } else p.style.display = 'none';

    // retikl virtuální páky
    const dot = this.el.stickDot;
    dot.style.transform = `translate(calc(-50% + ${stick.x * stickRadiusPx}px), calc(-50% + ${-stick.y * stickRadiusPx}px))`;
    const ring = this.el.stickRing;
    ring.style.width = `${stickRadiusPx * 2}px`;
    ring.style.height = `${stickRadiusPx * 2}px`;

    // varování
    const w = this.el.warnings;
    const cur = warnings.join('|');
    if (w.dataset.cur !== cur) {
      w.dataset.cur = cur;
      w.innerHTML = warnings.map((x) => `<div class="warn">${x}</div>`).join('');
    }
  }

  message(text: string, ms = 3500): void {
    const m = this.el.msg;
    m.textContent = text;
    m.style.display = 'block';
    window.clearTimeout((m as unknown as { _t?: number })._t);
    (m as unknown as { _t?: number })._t = window.setTimeout(() => { m.style.display = 'none'; }, ms);
  }

  setTelemetry(visible: boolean, text: string): void {
    const t = this.el.telemetry;
    t.style.display = visible ? 'block' : 'none';
    if (visible) t.textContent = text;
  }

  setHelp(visible: boolean): void {
    this.el.help.style.display = visible ? 'block' : 'none';
  }

  showReport(report: ShiftReport | null): void {
    const ov = this.el.reportOverlay;
    if (!report) { ov.classList.add('hidden'); return; }
    ov.classList.remove('hidden');
    const crosses = '✚'.repeat(report.crosses) + '<span style="opacity:0.25">' + '✚'.repeat(3 - report.crosses) + '</span>';
    this.el.report.innerHTML = `
      <h2>Pilotní poznámky — směna č. ${report.shift}</h2>
      <p class="dim">Doručeno ${report.delivered}/${report.total} kmenů · odměna ${report.moneyEarned} Kč</p>
      <p class="crosses">${crosses}</p>
      <ul>${report.notes.map((n) => `<li>${n}</li>`).join('')}</ul>
      <p class="dim">Plynulost ${(report.smoothness * 100) | 0} % · přesnost ${(report.accuracy * 100) | 0} % · bezpečnost ${(report.safety * 100) | 0} %</p>
      <button id="nextShiftBtn">Další směna (Enter)</button>`;
    const btn = this.el.report.querySelector('#nextShiftBtn') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      ov.classList.add('hidden');
      this.onNextShift?.();
    });
  }

  // Panel nastavení (klávesa O): „témata“ — čas dne, vítr, bouřka, test, režim letu.
  bindSettingsPanel(settings: ControlSettings, onChange: () => void, onLight: () => void = onChange): void {
    const time = this.el.setTime as HTMLSelectElement;
    const wind = this.el.setWind as HTMLSelectElement;
    const storm = this.el.setStorm as HTMLInputElement;
    const test = this.el.setTest as HTMLInputElement;
    const mode = this.el.setMode as HTMLSelectElement;
    const smooth = this.el.setSmooth as HTMLInputElement;
    const fov = this.el.setFov as HTMLInputElement;
    const zoom = this.el.setZoom as HTMLInputElement;
    const quality = this.el.setQuality as HTMLSelectElement;
    const trees = this.el.setTrees as HTMLInputElement;
    const treeLabel = this.el.treeCountLabel;
    const sync = () => {
      settings.timeOfDay = time.value as ControlSettings['timeOfDay'];
      settings.windLevel = parseInt(wind.value, 10);
      settings.storm = storm.checked;
      settings.testMode = test.checked;
      settings.mode = mode.value as ControlSettings['mode'];
      settings.stickSmoothing = parseFloat(smooth.value);
      settings.fov = parseFloat(fov.value);
      settings.zoom = parseFloat(zoom.value);
      settings.graphicsQuality = quality.value as ControlSettings['graphicsQuality'];
      settings.treeCount = parseInt(trees.value, 10);
      treeLabel.textContent = String(settings.treeCount);
      onChange();
    };
    const reflect = () => {
      time.value = settings.timeOfDay;
      wind.value = String(settings.windLevel);
      storm.checked = settings.storm;
      test.checked = settings.testMode;
      mode.value = settings.mode;
      smooth.value = String(settings.stickSmoothing);
      fov.value = String(settings.fov);
      zoom.value = String(settings.zoom);
      quality.value = settings.graphicsQuality;
      trees.value = String(settings.treeCount);
      treeLabel.textContent = String(settings.treeCount);
    };
    // změna kvality/počtu stromů = těžká (přestaví se scéna) → jen 'change'; posuvníky jen ukládají
    for (const el of [time, wind, storm, test, mode, quality, trees]) el.addEventListener('change', sync);
    for (const el of [smooth, fov, zoom]) el.addEventListener('input', () => {
      settings.stickSmoothing = parseFloat(smooth.value);
      settings.fov = parseFloat(fov.value);
      settings.zoom = parseFloat(zoom.value);
      onLight();
    });
    trees.addEventListener('input', () => { treeLabel.textContent = trees.value; });
    this.el.closeSettingsBtn.addEventListener('click', () => this.showSettings(false));
    this.el.openSettingsBtn.addEventListener('click', () => { this.showPause(false); this.showSettings(true); });
    reflect();
    this._reflectSettings = reflect;
  }

  private _reflectSettings: (() => void) | null = null;

  showSettings(v: boolean): void {
    this.el.settingsOverlay.classList.toggle('hidden', !v);
    if (v && this._reflectSettings) this._reflectSettings();
  }

  setModeBadge(text: string): void {
    if (this.el.modeBadge.textContent !== text) this.el.modeBadge.textContent = text;
  }

  onNextShift: (() => void) | null = null;
}
