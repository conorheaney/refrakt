export type Bus = 'sfx' | 'music' | 'echo' | 'ambience';

export interface ToneOptions {
  freq: number;
  /** Glide target; omitted for a steady pitch. */
  endFreq?: number;
  type?: OscillatorType;
  dur: number;
  vol: number;
  attack?: number;
  pan?: number;
  /** Absolute AudioContext start time; defaults to now. */
  when?: number;
  /** Low-pass cutoff in Hz. */
  filter?: number;
  bus?: Bus;
}

export interface NoiseOptions {
  dur: number;
  vol: number;
  filterType?: BiquadFilterType;
  filter?: number;
  endFilter?: number;
  pan?: number;
  when?: number;
  bus?: Bus;
}

export interface SampleOptions {
  vol: number;
  pan?: number;
  /** Absolute AudioContext start time; defaults to now. */
  when?: number;
  /** Playback rate: below 1 is slower and deeper. */
  rate?: number;
  /** Seconds into the clip to start from. */
  offset?: number;
  /** Stop (with a short fade) after this many seconds of the clip. */
  dur?: number;
  /** Fade in and out over these many seconds instead of starting at full volume (with `dur`, for fadeOut). */
  fadeIn?: number;
  fadeOut?: number;
  /** Low-pass cutoff in Hz. */
  filter?: number;
  /**
   * Movement over the clip (or over `dur` when given): the pan glides from `pan` to `panTo`, and the low-pass
   * cutoff glides from `filter` up to `filterPeak` at the middle and back down. Used for gusts of wind.
   */
  panTo?: number;
  filterPeak?: number;
  /** 'sfx' (default) or 'ambience' (weather and other background sound). */
  bus?: 'sfx' | 'ambience';
}

/** A running noise band from `AudioEngine.noiseBed`. */
export interface NoiseBed {
  /** Glide to `vol` over about `ramp` seconds. */
  setLevel(vol: number, ramp?: number): void;
  /** Fade out over `fade` seconds and release it. */
  stop(fade?: number): void;
}

/** Crossfade length when a recording is turned into a seamless loop (see `setLoop`). */
const LOOP_CROSSFADE = 1.5;

interface LoopState {
  /** Volume wanted; 0 means stopped (or stopping). */
  vol: number;
  fade: number;
  bus: 'sfx' | 'ambience';
  src: AudioBufferSourceNode | null;
  gain: GainNode | null;
}

/**
 * Thin Web Audio wrapper. Most sound in Refrakt is synthesised at runtime; a few recorded effects
 * (listed in src/app/audio/samples.ts) are registered with `addSamples` and decoded once the context
 * exists. The context is created lazily on the first user gesture (browser autoplay policy) and every
 * call is a safe no-op until then or when Web Audio is unavailable. `sample` returns false while a clip
 * is still loading (or failed to), so callers can fall back to a synthesised sound.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private echoBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly sampleUrls = new Map<string, string>();
  /** Clips asked for (want), loaded once the context exists; each is fetched only once. */
  private readonly wanted = new Set<string>();
  private readonly requested = new Set<string>();
  private readonly samples = new Map<string, AudioBuffer>();
  /** Seamless versions of looped samples, built on first use. */
  private readonly loopBuffers = new Map<string, AudioBuffer>();
  private readonly loops = new Map<string, LoopState>();
  private ambienceVolume = 0.7;
  private musicVolume = 0.6;
  private sfxVolume = 0.8;
  private muted = false;
  private failed = false;
  /** Share of the ambience volume that plays (lowered while the game is paused). */
  private ambienceDuck = 1;
  /** True while the page is hidden: the whole context is suspended (silent, and no CPU spent). */
  private suspended = false;

  get context(): AudioContext | null {
    return this.ctx;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Call from a user gesture. Creates or resumes the context. */
  unlock(): void {
    if (this.failed) return;
    try {
      if (!this.ctx) this.build();
      if (this.ctx && this.ctx.state === 'suspended' && !this.suspended) void this.ctx.resume();
    } catch (err) {
      this.failed = true;
      console.warn('[Audio] disabled:', err);
    }
  }

  /**
   * Builds the engine on a context you supply instead of the live one: an OfflineAudioContext, to record the
   * music to a file (app/audio/renderMusic.ts, the world editor's "Save recording"). Not used by the game.
   */
  attach(ctx: BaseAudioContext): void {
    this.build(ctx as AudioContext);
  }

  private build(supplied?: AudioContext): void {
    const ctx = supplied ?? new AudioContext({ latencyHint: 'interactive' });
    // Master compressor: catches peaks when many sounds land at once. The threshold sits high enough that
    // ordinary play passes through untouched; a lower one squashed the whole mix, music included.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -8;
    compressor.knee.value = 6;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    compressor.connect(ctx.destination);

    const master = ctx.createGain();
    master.connect(compressor);
    const musicBus = ctx.createGain();
    musicBus.connect(master);
    const sfxBus = ctx.createGain();
    sfxBus.connect(master);
    const ambienceBus = ctx.createGain();
    ambienceBus.connect(master);

    // Tempo-ish feedback echo for arpeggios.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.375;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const echoBus = ctx.createGain();
    echoBus.connect(musicBus);
    echoBus.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(musicBus);

    const length = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    this.ctx = ctx;
    this.master = master;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
    this.echoBus = echoBus;
    this.ambienceBus = ambienceBus;
    this.noiseBuffer = buffer;
    this.applyVolumes();
    for (const name of this.wanted) this.load(name);
    for (const name of this.loops.keys()) this.applyLoop(name);
  }

  /** Registers recorded clips by name. Nothing is fetched until a clip is wanted (see want). */
  addSamples(urls: Record<string, string>): void {
    for (const [name, url] of Object.entries(urls)) this.sampleUrls.set(name, url);
  }

  /**
   * Asks for registered clips to be fetched and decoded: now if audio has started, else as soon as it does.
   * Each clip is fetched once. Until a clip has loaded, sample() returns false (callers fall back to a
   * synthesised sound) and a loop asked for with setLoop starts when it arrives.
   */
  want(names: Iterable<string>): void {
    for (const name of names) {
      this.wanted.add(name);
      if (this.ctx) this.load(name);
    }
  }

  /** Whether a clip has been fetched and decoded. */
  hasSample(name: string): boolean {
    return this.samples.has(name);
  }

  private load(name: string): void {
    const ctx = this.ctx;
    const url = this.sampleUrls.get(name);
    if (!ctx || !url || this.requested.has(name)) return;
    this.requested.add(name);
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        this.samples.set(name, buffer);
        this.applyLoop(name);
      })
      .catch((err) => console.warn(`[Audio] sound "${name}" unavailable; using a synthesised fallback.`, err));
  }

  /** Plays a recorded clip on the effects bus. False when it is not loaded (yet), so nothing played. */
  sample(name: string, o: SampleOptions): boolean {
    const ctx = this.ctx;
    const buffer = this.samples.get(name);
    if (!ctx || ctx.state !== 'running' || !buffer) return false;
    const t = Math.max(ctx.currentTime, o.when ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = o.rate ?? 1;
    const gain = ctx.createGain();
    if (o.fadeIn) {
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(o.vol, t + o.fadeIn);
    } else {
      gain.gain.setValueAtTime(o.vol, t);
    }
    const length = o.dur ?? (buffer.duration - (o.offset ?? 0)) / (o.rate ?? 1);
    let tail: AudioNode = src;
    if (o.filter !== undefined) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(o.filter, t);
      if (o.filterPeak !== undefined) {
        filter.frequency.exponentialRampToValueAtTime(o.filterPeak, t + length * 0.5);
        filter.frequency.exponentialRampToValueAtTime(o.filter, t + length);
      }
      tail.connect(filter);
      tail = filter;
    }
    tail.connect(gain);
    if (o.panTo !== undefined) {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, o.pan ?? 0)), t);
      panner.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, o.panTo)), t + length);
      gain.connect(panner);
      this.output(panner, 0, o.bus ?? 'sfx');
    } else {
      this.output(gain, o.pan, o.bus ?? 'sfx');
    }
    src.start(t, o.offset ?? 0);
    if (o.dur !== undefined) {
      gain.gain.setValueAtTime(o.vol, t + Math.max(o.fadeIn ?? 0, o.dur - (o.fadeOut ?? 0.08)));
      gain.gain.linearRampToValueAtTime(0.0001, t + o.dur);
      src.stop(t + o.dur + 0.02);
    }
    return true;
  }

  /**
   * Fades a looping recording (on the ambience bus unless `bus` says otherwise) to `vol` over `fade` seconds;
   * 0 fades it out and stops it.
   * The wish is remembered, so a loop asked for before audio is unlocked or the clip has loaded starts as
   * soon as it can.
   */
  setLoop(name: string, vol: number, fade = 2, bus: 'sfx' | 'ambience' = 'ambience'): void {
    const state = this.loops.get(name) ?? { vol: 0, fade, bus, src: null, gain: null };
    state.vol = vol;
    state.fade = fade;
    state.bus = bus;
    this.loops.set(name, state);
    this.applyLoop(name);
  }

  private applyLoop(name: string): void {
    const ctx = this.ctx;
    const state = this.loops.get(name);
    if (!ctx || !state) return;
    const t = ctx.currentTime;
    if (state.vol > 0 && !state.src) {
      const buffer = this.loopBuffer(name);
      if (!buffer) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      src.connect(gain);
      this.output(gain, 0, state.bus);
      src.start(t, Math.random() * buffer.duration);
      state.src = src;
      state.gain = gain;
    }
    if (!state.src || !state.gain) return;
    const g = state.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(Math.max(0.0001, state.vol), t + state.fade);
    if (state.vol <= 0) {
      state.src.stop(t + state.fade + 0.05);
      state.src = null;
      state.gain = null;
    }
  }

  /**
   * A copy of a sample whose last LOOP_CROSSFADE seconds are blended into its start (equal power), so it
   * repeats with no seam. Decoded MP3s can carry a few silent padding frames at either end; those are trimmed.
   */
  private loopBuffer(name: string): AudioBuffer | null {
    const cached = this.loopBuffers.get(name);
    if (cached) return cached;
    const ctx = this.ctx;
    const source = this.samples.get(name);
    if (!ctx || !source) return null;
    const sr = source.sampleRate;
    const trim = Math.floor(0.06 * sr);
    const xf = Math.floor(LOOP_CROSSFADE * sr);
    const length = source.length - 2 * trim - xf;
    if (length <= xf) return source;
    const out = ctx.createBuffer(source.numberOfChannels, length, sr);
    for (let c = 0; c < source.numberOfChannels; c++) {
      const x = source.getChannelData(c).subarray(trim, trim + length + xf);
      const y = out.getChannelData(c);
      y.set(x.subarray(0, length));
      for (let i = 0; i < xf; i++) {
        const k = i / xf;
        y[i] = x[i] * Math.sin((k * Math.PI) / 2) + x[length + i] * Math.cos((k * Math.PI) / 2);
      }
    }
    this.loopBuffers.set(name, out);
    return out;
  }

  setVolumes(music: number, sfx: number, ambience: number): void {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    this.ambienceVolume = ambience;
    this.applyVolumes();
  }

  /**
   * Silences everything while the page is hidden (a background tab): suspends the audio context, and resumes
   * it when the page is shown again. Before audio is unlocked there is nothing to suspend.
   */
  setSuspended(on: boolean): void {
    this.suspended = on;
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && ctx.state === 'running') void ctx.suspend();
    else if (!on && ctx.state === 'suspended') void ctx.resume();
  }

  /** Plays the ambience bus at `level` (0-1) of its volume, easing there (e.g. quieter while paused). */
  setAmbienceDuck(level: number): void {
    this.ambienceDuck = level;
    this.applyVolumes(0.25);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyVolumes();
    return this.muted;
  }

  /** `ease`: time constant (seconds) of the change; short for settings, longer for ducking. */
  private applyVolumes(ease = 0.03): void {
    if (!this.ctx || !this.master || !this.musicBus || !this.sfxBus || !this.ambienceBus) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, t, 0.03);
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 1.6, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume, t, 0.03);
    this.ambienceBus.gain.setTargetAtTime(this.ambienceVolume * this.ambienceDuck, t, ease);
  }

  private busNode(bus: Bus | undefined): GainNode | null {
    if (bus === 'ambience') return this.ambienceBus;
    return bus === 'music' ? this.musicBus : bus === 'echo' ? this.echoBus : this.sfxBus;
  }

  private output(node: AudioNode, pan: number | undefined, bus: Bus | undefined): void {
    const ctx = this.ctx;
    const dest = this.busNode(bus);
    if (!ctx || !dest) return;
    if (pan !== undefined && pan !== 0) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(panner);
      panner.connect(dest);
    } else {
      node.connect(dest);
    }
  }

  tone(o: ToneOptions): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = Math.max(ctx.currentTime, o.when ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.endFreq), t + o.dur);

    const gain = ctx.createGain();
    const attack = o.attack ?? 0.004;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(o.vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, o.dur));

    let tail: AudioNode = osc;
    if (o.filter !== undefined) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = o.filter;
      filter.Q.value = 1.2;
      tail.connect(filter);
      tail = filter;
    }
    tail.connect(gain);
    this.output(gain, o.pan, o.bus);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  noise(o: NoiseOptions): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.noiseBuffer) return;
    const t = Math.max(ctx.currentTime, o.when ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = o.filterType ?? 'lowpass';
    filter.frequency.setValueAtTime(o.filter ?? 2000, t);
    if (o.endFilter !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.endFilter), t + o.dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(o.vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    src.connect(filter);
    filter.connect(gain);
    this.output(gain, o.pan, o.bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + o.dur + 0.05);
  }
  /**
   * A long sound that fades in over `attack`, holds for `hold`, then dies away over `release`, so it stays
   * audible for the whole of an event (a tomb rumble). `source` is 'noise' or an oscillator type with `freq`.
   * `tremolo` shakes the level (rate in Hz, depth 0-1) for a grinding, juddering sound.
   */
  swell(o: {
    source: 'noise' | OscillatorType;
    freq?: number;
    endFreq?: number;
    filterType?: BiquadFilterType;
    filter: number;
    endFilter?: number;
    q?: number;
    vol: number;
    attack: number;
    hold: number;
    release: number;
    tremolo?: { rate: number; depth: number };
    pan?: number;
    when?: number;
    bus?: Bus;
  }): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (o.source === 'noise' && !this.noiseBuffer) return;
    const t = Math.max(ctx.currentTime, o.when ?? 0);
    const end = t + o.attack + o.hold + o.release;

    let src: AudioBufferSourceNode | OscillatorNode;
    if (o.source === 'noise') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      src = noise;
    } else {
      const osc = ctx.createOscillator();
      osc.type = o.source;
      osc.frequency.setValueAtTime(o.freq ?? 60, t);
      if (o.endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.endFreq), end);
      src = osc;
    }

    const filter = ctx.createBiquadFilter();
    filter.type = o.filterType ?? 'lowpass';
    filter.Q.value = o.q ?? 0.7;
    filter.frequency.setValueAtTime(o.filter, t);
    if (o.endFilter !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.endFilter), end);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(o.vol, t + o.attack);
    gain.gain.setValueAtTime(o.vol, t + o.attack + o.hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    src.connect(filter);
    filter.connect(gain);
    let out: AudioNode = gain;
    let lfo: OscillatorNode | null = null;
    if (o.tremolo) {
      // A second gain stage whose level wobbles between 1 - depth and 1.
      const shake = ctx.createGain();
      shake.gain.value = 1 - o.tremolo.depth / 2;
      lfo = ctx.createOscillator();
      lfo.frequency.value = o.tremolo.rate;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = o.tremolo.depth / 2;
      lfo.connect(lfoDepth);
      lfoDepth.connect(shake.gain);
      gain.connect(shake);
      out = shake;
    }
    this.output(out, o.pan, o.bus);
    if (src instanceof AudioBufferSourceNode) src.start(t, Math.random() * 0.5);
    else src.start(t);
    src.stop(end + 0.05);
    lfo?.start(t);
    lfo?.stop(end + 0.05);
  }

  /**
   * A continuous band of filtered noise whose level can be moved smoothly (a hiss or hum under the weather).
   * Starts silent; null until the context is running. Call `stop` when done with it.
   */
  noiseBed(o: { filterType?: BiquadFilterType; filter: number; q?: number; pan?: number; bus?: Bus }): NoiseBed | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.noiseBuffer) return null;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filterType ?? 'lowpass';
    filter.frequency.value = o.filter;
    filter.Q.value = o.q ?? 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    this.output(gain, o.pan, o.bus);
    src.start(ctx.currentTime, Math.random() * 0.5);
    return {
      setLevel(vol: number, ramp = 0.25): void {
        gain.gain.setTargetAtTime(vol, ctx.currentTime, ramp / 3);
      },
      stop(fade = 1): void {
        gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
        src.stop(ctx.currentTime + fade + 0.1);
      },
    };
  }
}
