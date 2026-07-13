/**
 * Sound manager. Plays files from /assets/sfx when present (Universal UI
 * Soundpack — see assets/README.md for the drop-in filenames), otherwise
 * synthesizes small WebAudio blips so the game is never silent.
 */
type SfxName =
  | 'click' | 'coin' | 'swoosh' | 'crash' | 'combo' | 'start'
  | 'squish' | 'nitro' | 'bump' | 'count' | 'go' | 'finish' | 'skid'
  | 'shot' | 'blowout' | 'empty'
  | 'select' | 'back' | 'buy' | 'open' // menu foley — each action has a voice
  | 'ignition'; // engine turnover during the countdown

const FILES: Record<SfxName, string> = {
  select: 'select',
  back: 'back',
  buy: 'buy',
  open: 'open',
  click: 'ui_click',
  coin: 'coin',
  swoosh: 'swoosh',
  crash: 'crash',
  combo: 'combo',
  start: 'start',
  squish: 'squish',
  nitro: 'nitro',
  bump: 'bump',
  count: 'count',
  go: 'go',
  finish: 'finish',
  skid: 'skid',
  shot: 'gun_shot',
  blowout: 'tire_blowout',
  empty: 'gun_empty',
  ignition: 'engine_start'
};

const EXTENSIONS = ['ogg', 'mp3', 'wav'];

// gameplay impacts buzz the phone (Android; iOS has no vibrate API).
// menu sounds deliberately absent — haptic menus feel broken, not premium.
const HAPTICS: Partial<Record<SfxName, number | number[]>> = {
  crash: [90, 40, 90],
  bump: 35,
  squish: 14,
  blowout: 70,
  shot: 20,
  go: 45,
  finish: [40, 60, 120]
};

/**
 * Fallback chiptune loops (16 8th-note steps) for when /assets/music has no
 * real track — same "never silent" rule as the sfx synth. Hz, 0 = rest.
 */
interface SynthTune {
  bpm: number;
  bassType: OscillatorType;
  bass: number[];
  lead: number[];
  drums: boolean;
}

// menu: laid-back Am–F–C–G arpeggio over a round sine bass
const MENU_TUNE: SynthTune = {
  bpm: 96, bassType: 'sine', drums: false,
  bass: [110, 0, 0, 0, 87.3, 0, 0, 0, 130.8, 0, 0, 0, 98, 0, 0, 0],
  lead: [220, 261.6, 329.6, 440, 329.6, 261.6, 220, 261.6,
         174.6, 220, 261.6, 349.2, 329.6, 261.6, 246.9, 196]
};

// race: pumping square bass + kick/hat, lead stabs on the off-beats
const RACE_TUNE: SynthTune = {
  bpm: 148, bassType: 'square', drums: true,
  bass: [110, 110, 0, 110, 110, 0, 110, 110, 130.8, 130.8, 0, 130.8, 146.8, 0, 146.8, 130.8],
  lead: [0, 0, 440, 0, 0, 523.3, 0, 440, 0, 0, 523.3, 0, 587.3, 0, 523.3, 0]
};

export class AudioManager {
  private ctx: AudioContext | null = null;
  private buffers = new Map<SfxName, AudioBuffer>();
  private base = `${import.meta.env.BASE_URL}assets/sfx/`;
  private musicBase = `${import.meta.env.BASE_URL}assets/music/`;
  private engineBuf: AudioBuffer | null = null;
  private engineSrc: AudioBufferSourceNode | null = null;
  private engineGain: GainNode | null = null;
  private musicBufs = new Map<string, AudioBuffer>();
  private musicSrc: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private musicName: string | null = null;
  private synthTimer: number | null = null;
  private musicVol = 0.3;
  muted = false;

  /** Mute/unmute everything live — running music and engine included. */
  setMuted(m: boolean): void {
    this.muted = m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (m) {
      this.engineGain?.gain.setTargetAtTime(0, t, 0.05);
      this.musicGain?.gain.setTargetAtTime(0, t, 0.05);
    } else {
      this.musicGain?.gain.setTargetAtTime(this.musicVol, t, 0.1);
      // music that was requested while muted never started — start it now
      if (this.musicName && !this.musicSrc && this.synthTimer === null) {
        const name = this.musicName;
        this.musicName = null;
        void this.playMusic(name, this.musicVol);
      }
    }
  }

  /** Must be called from a user gesture (MiniPay/iOS autoplay policy). */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      void this.preload();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private async preload(): Promise<void> {
    if (!this.ctx) return;
    await Promise.all([
      ...(Object.keys(FILES) as SfxName[]).map(async (name) => {
        const buf = await this.fetchBuffer(`${this.base}${FILES[name]}`);
        if (buf) this.buffers.set(name, buf);
      }),
      this.fetchBuffer(`${this.base}engine`).then((buf) => (this.engineBuf = buf))
    ]);
  }

  /** Try each extension for a sound at the given extensionless URL. */
  private async fetchBuffer(url: string): Promise<AudioBuffer | null> {
    for (const ext of EXTENSIONS) {
      try {
        const res = await fetch(`${url}.${ext}`);
        if (!res.ok) continue;
        const type = res.headers.get('content-type') ?? '';
        if (type.includes('text/html')) continue; // dev server SPA fallback
        return await this.ctx!.decodeAudioData(await res.arrayBuffer());
      } catch {
        /* try next extension */
      }
    }
    return null;
  }

  /** Start the looping engine bed (no-op without the engine.mp3 asset). */
  startEngine(): void {
    if (this.muted || !this.ctx || !this.engineBuf || this.engineSrc) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.engineBuf;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
    this.engineSrc = src;
    this.engineGain = gain;
  }

  /** Steer the engine loop: rate ≈ RPM (0.5 idle … 1.6 flat out). */
  engine(rate: number, volume: number): void {
    if (!this.ctx || !this.engineSrc || !this.engineGain) return;
    const t = this.ctx.currentTime;
    this.engineSrc.playbackRate.setTargetAtTime(rate, t, 0.08);
    this.engineGain.gain.setTargetAtTime(this.muted ? 0 : volume, t, 0.1);
  }

  stopEngine(): void {
    if (!this.ctx || !this.engineSrc || !this.engineGain) return;
    const src = this.engineSrc;
    this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    setTimeout(() => src.stop(), 600);
    this.engineSrc = null;
    this.engineGain = null;
  }

  /**
   * Loop a track from /assets/music (e.g. 'menu', 'race'). Loads lazily; when
   * no file exists it falls back to a synthesized chiptune loop.
   */
  async playMusic(name: string, volume = 0.3): Promise<void> {
    if (!this.ctx || this.musicName === name) return;
    this.musicName = name;
    this.musicVol = volume;
    if (this.muted) return; // remembered — setMuted(false) starts it
    let buf = this.musicBufs.get(name) ?? null;
    if (!buf) {
      buf = await this.fetchBuffer(`${this.musicBase}${name}`);
      if (buf) this.musicBufs.set(name, buf);
    }
    if (this.musicName !== name) return; // superseded while loading
    if (!buf) {
      this.startSynthMusic(name);
      return;
    }
    this.stopMusicSource();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + 1.2);
    src.connect(gain).connect(this.ctx.destination);
    src.start();
    this.musicSrc = src;
    this.musicGain = gain;
  }

  stopMusic(): void {
    this.musicName = null;
    this.stopMusicSource();
  }

  private stopMusicSource(): void {
    if (this.synthTimer !== null) {
      clearInterval(this.synthTimer);
      this.synthTimer = null;
    }
    if (!this.ctx || !this.musicSrc || !this.musicGain) return;
    const src = this.musicSrc;
    this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
    setTimeout(() => src.stop(), 1000);
    this.musicSrc = null;
    this.musicGain = null;
  }

  /** Lookahead step sequencer for the fallback tunes. */
  private startSynthMusic(name: string): void {
    this.stopMusicSource();
    const ctx = this.ctx!;
    const tune = name === 'race' ? RACE_TUNE : MENU_TUNE;
    const stepDur = 60 / tune.bpm / 2; // 8th notes
    let step = 0;
    let nextT = ctx.currentTime + 0.08;
    this.synthTimer = window.setInterval(() => {
      while (nextT < ctx.currentTime + 0.3) {
        const i = step % 16;
        if (!this.muted) {
          if (tune.bass[i]) this.musicNote(tune.bass[i], nextT, stepDur * 0.85, tune.bassType, 0.05);
          if (tune.lead[i]) this.musicNote(tune.lead[i], nextT, stepDur * 0.7, 'triangle', 0.035);
          if (tune.drums && i % 4 === 0) this.musicKick(nextT);
          if (tune.drums && i % 2 === 1) this.musicHat(nextT);
        }
        nextT += stepDur;
        step++;
      }
    }, 100);
  }

  private musicNote(freq: number, at: number, dur: number, type: OscillatorType, peak: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  private musicKick(at: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, at);
    osc.frequency.exponentialRampToValueAtTime(42, at + 0.11);
    g.gain.setValueAtTime(0.12, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
    osc.connect(g).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.15);
  }

  private musicHat(at: number): void {
    const ctx = this.ctx!;
    const len = 0.04;
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    noise.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.value = 0.03;
    noise.connect(filter).connect(g).connect(ctx.destination);
    noise.start(at);
  }

  play(name: SfxName, volume = 1): void {
    const buzz = HAPTICS[name];
    if (buzz) {
      try {
        navigator.vibrate?.(buzz);
      } catch { /* unsupported */ }
    }
    if (this.muted || !this.ctx) return;
    // don't drop sounds while resume() is still settling — scheduled nodes
    // fire as soon as the context actually runs
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const buf = this.buffers.get(name);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.value = volume;
      src.connect(gain).connect(this.ctx.destination);
      src.start();
    } else {
      this.synth(name, volume);
    }
  }

  private synth(name: SfxName, volume: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    const tone = (freq: number, at: number, dur: number, type: OscillatorType = 'square', peak = 0.12) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(peak * volume, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t + at);
      osc.stop(t + at + dur + 0.02);
    };

    switch (name) {
      case 'click':
        tone(660, 0, 0.06, 'square', 0.08);
        break;
      case 'coin':
        tone(988, 0, 0.07, 'square', 0.09);
        tone(1319, 0.06, 0.12, 'square', 0.09);
        break;
      case 'swoosh': {
        const len = 0.18;
        const noise = ctx.createBufferSource();
        const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        noise.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(500, t);
        filter.frequency.exponentialRampToValueAtTime(2200, t + len);
        const g = ctx.createGain();
        g.gain.value = 0.1 * volume;
        noise.connect(filter).connect(g).connect(ctx.destination);
        noise.start(t);
        break;
      }
      case 'crash': {
        const len = 0.5;
        const noise = ctx.createBufferSource();
        const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.6);
        noise.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2400, t);
        filter.frequency.exponentialRampToValueAtTime(180, t + len);
        const g = ctx.createGain();
        g.gain.value = 0.3 * volume;
        noise.connect(filter).connect(g).connect(ctx.destination);
        noise.start(t);
        tone(90, 0, 0.4, 'sawtooth', 0.18);
        break;
      }
      case 'combo':
        tone(784, 0, 0.08, 'square', 0.08);
        tone(988, 0.07, 0.08, 'square', 0.08);
        tone(1175, 0.14, 0.14, 'square', 0.08);
        break;
      case 'start':
        tone(523, 0, 0.1, 'square', 0.09);
        tone(659, 0.1, 0.1, 'square', 0.09);
        tone(784, 0.2, 0.18, 'square', 0.1);
        break;
      case 'squish': {
        const len = 0.14;
        const noise = ctx.createBufferSource();
        const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        noise.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(900, t);
        filter.frequency.exponentialRampToValueAtTime(140, t + len);
        const g = ctx.createGain();
        g.gain.value = 0.22 * volume;
        noise.connect(filter).connect(g).connect(ctx.destination);
        noise.start(t);
        tone(120, 0, 0.1, 'sine', 0.14);
        break;
      }
      case 'nitro': {
        const len = 0.55;
        const noise = ctx.createBufferSource();
        const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        noise.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 2;
        filter.frequency.setValueAtTime(300, t);
        filter.frequency.exponentialRampToValueAtTime(3600, t + len);
        const g = ctx.createGain();
        g.gain.value = 0.16 * volume;
        noise.connect(filter).connect(g).connect(ctx.destination);
        noise.start(t);
        break;
      }
      case 'bump':
        tone(75, 0, 0.16, 'sawtooth', 0.2);
        tone(55, 0.02, 0.2, 'sine', 0.18);
        break;
      case 'skid': {
        // tire chirp: high-passed noise sweeping down
        const len = 0.35;
        const noise = ctx.createBufferSource();
        const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        noise.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 4;
        filter.frequency.setValueAtTime(2600, t);
        filter.frequency.exponentialRampToValueAtTime(1100, t + len);
        const g = ctx.createGain();
        g.gain.value = 0.08 * volume;
        noise.connect(filter).connect(g).connect(ctx.destination);
        noise.start(t);
        break;
      }
      case 'shot': {
        // sharp crack: short highpassed noise + low thump
        const len = 0.09;
        const noise = ctx.createBufferSource();
        const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
        noise.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 1400;
        const g = ctx.createGain();
        g.gain.value = 0.28 * volume;
        noise.connect(filter).connect(g).connect(ctx.destination);
        noise.start(t);
        tone(110, 0, 0.07, 'square', 0.14);
        break;
      }
      case 'blowout': {
        // tire pop + escaping hiss
        tone(180, 0, 0.08, 'square', 0.2);
        const len = 0.4;
        const noise = ctx.createBufferSource();
        const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        noise.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(3200, t);
        filter.frequency.exponentialRampToValueAtTime(700, t + len);
        const g = ctx.createGain();
        g.gain.value = 0.14 * volume;
        noise.connect(filter).connect(g).connect(ctx.destination);
        noise.start(t + 0.04);
        break;
      }
      case 'empty':
        tone(320, 0, 0.04, 'square', 0.07);
        tone(240, 0.05, 0.04, 'square', 0.07);
        break;
      case 'select':
        tone(520, 0, 0.05, 'square', 0.06);
        break;
      case 'back':
        tone(392, 0, 0.05, 'square', 0.07);
        tone(294, 0.05, 0.07, 'square', 0.07);
        break;
      case 'buy':
        tone(880, 0, 0.07, 'square', 0.09);
        tone(1175, 0.06, 0.09, 'square', 0.09);
        tone(1568, 0.13, 0.16, 'square', 0.1);
        break;
      case 'open':
        tone(587, 0, 0.06, 'square', 0.07);
        tone(880, 0.05, 0.1, 'square', 0.08);
        break;
      case 'count':
        tone(440, 0, 0.12, 'square', 0.1);
        break;
      case 'go':
        tone(880, 0, 0.3, 'square', 0.12);
        break;
      case 'finish':
        tone(523, 0, 0.12, 'square', 0.1);
        tone(659, 0.12, 0.12, 'square', 0.1);
        tone(784, 0.24, 0.12, 'square', 0.1);
        tone(1047, 0.36, 0.3, 'square', 0.12);
        break;
    }
    gain.disconnect();
  }
}
