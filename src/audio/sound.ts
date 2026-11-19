// ============================================================================
// Procedurální zvuk přes Web Audio (oddíl 9) — žádné externí soubory.
// Rotor = oscilátory s frekvencí průchodu listů (listy/s podle Ω),
// motor = šum přes pásmový filtr, vítr = filtrovaný šum podle rychlosti,
// lano = jemné skřípání při napětí. Klávesa M ztlumí vše.
// ============================================================================

import { AUDIO } from '../config';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private rotorOsc!: OscillatorNode;
  private rotorSub!: OscillatorNode;
  private rotorGain!: GainNode;
  private rotorLfo!: OscillatorNode;
  private rotorLfoGain!: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private creakTimer = 0;
  muted = false;
  private started = false;

  // musí zavolat až po uživatelském gestu (autoplay policy prohlížeče)
  start(): void {
    if (this.started) return;
    this.started = true;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = AUDIO.masterVolume;
    this.master.connect(ctx.destination);

    // sdílený bílý šum
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // rotor: hlavní oscilátor (průchod listů) + sub + „chvění“ přes LFO
    this.rotorGain = ctx.createGain();
    this.rotorGain.gain.value = 0;
    const rotorFilter = ctx.createBiquadFilter();
    rotorFilter.type = 'lowpass';
    rotorFilter.frequency.value = 900;
    this.rotorOsc = ctx.createOscillator();
    this.rotorOsc.type = 'sawtooth';
    this.rotorSub = ctx.createOscillator();
    this.rotorSub.type = 'triangle';
    this.rotorLfo = ctx.createOscillator();
    this.rotorLfo.frequency.value = 11;
    this.rotorLfoGain = ctx.createGain();
    this.rotorLfoGain.gain.value = 0;
    this.rotorLfo.connect(this.rotorLfoGain);
    this.rotorLfoGain.connect(this.rotorGain.gain);
    this.rotorOsc.connect(rotorFilter);
    this.rotorSub.connect(rotorFilter);
    rotorFilter.connect(this.rotorGain);
    this.rotorGain.connect(this.master);
    this.rotorOsc.start();
    this.rotorSub.start();
    this.rotorLfo.start();

    // motor: šum přes bandpass, frekvence podle výkonu
    const engineSrc = ctx.createBufferSource();
    engineSrc.buffer = this.noiseBuf;
    engineSrc.loop = true;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'bandpass';
    this.engineFilter.frequency.value = 120;
    this.engineFilter.Q.value = 1.2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    engineSrc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    engineSrc.start();

    // vítr: šum přes lowpass, hlasitost podle rychlosti vzduchu
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noiseBuf;
    windSrc.loop = true;
    windSrc.playbackRate.value = 0.7;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    windSrc.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : AUDIO.masterVolume;
  }

  // volá se každý frame
  update(dt: number, omegaFrac: number, blades: number, rotorRpmNom: number, powerKw: number, engineOn: boolean, airspeed: number, tensionFrac: number, loadAttached: boolean): void {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const bladePass = blades * (omegaFrac * rotorRpmNom / 60); // listy za sekundu
    this.rotorOsc.frequency.setTargetAtTime(Math.max(1, bladePass), t, 0.05);
    this.rotorSub.frequency.setTargetAtTime(Math.max(0.5, bladePass / 2), t, 0.05);
    const rotorVol = AUDIO.rotorVolume * omegaFrac * (0.75 + 0.45 * (loadAttached ? 1 : 0));
    this.rotorGain.gain.setTargetAtTime(rotorVol * 0.16, t, 0.08);
    this.rotorLfoGain.gain.setTargetAtTime(rotorVol * 0.05, t, 0.1);
    // motor
    const engVol = engineOn ? AUDIO.engineVolume * (0.25 + 0.75 * Math.min(1, powerKw / 5000)) : 0;
    this.engineGain.gain.setTargetAtTime(engVol, t, 0.15);
    this.engineFilter.frequency.setTargetAtTime(90 + powerKw * 0.05 + omegaFrac * 60, t, 0.2);
    // vítr
    const windVol = AUDIO.windVolume * Math.min(1, airspeed / 45) * (0.4 + 0.6 * Math.min(1, airspeed / 20));
    this.windGain.gain.setTargetAtTime(windVol * 0.5, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(300 + airspeed * 40, t, 0.2);
    // skřípání lana při vysokém napětí (7.5)
    if (tensionFrac > 0.55 && loadAttached) {
      this.creakTimer -= dt;
      if (this.creakTimer <= 0) {
        this.creakTimer = 0.25 + Math.random() * 0.5;
        this.creak(tensionFrac);
      }
    }
  }

  private creak(intensity: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 180 + Math.random() * 260;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(AUDIO.ropeVolume * 0.12 * intensity, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900 + Math.random() * 800;
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  // krátký „bip“ pro radiogram / doručení
  blip(freq = 880, dur = 0.09, vol = 0.12): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
