/** An audio engine that records what it is asked to play, on a clock the test moves. */
export class FakeAudio {
  readonly context = { currentTime: 0, state: 'running' };
  /** One entry per one-shot sound (tone, noise, sample, swell), by method; `samples` names each recording played. */
  readonly played: string[] = [];
  readonly samples: string[] = [];
  readonly loops = new Map<string, number>();
  /** Recordings registered (addSamples) and asked to load (want). */
  readonly registered = new Set<string>();
  readonly wanted = new Set<string>();
  duck = 1;
  tone(): void {
    this.played.push('tone');
  }
  noise(): void {
    this.played.push('noise');
  }
  sample(name: string): boolean {
    this.played.push('sample');
    this.samples.push(name);
    return true;
  }
  swell(): void {
    this.played.push('swell');
  }
  noiseBed(): null {
    return null;
  }
  setLoop(name: string, vol: number): void {
    this.loops.set(name, vol);
  }
  setAmbienceDuck(level: number): void {
    this.duck = level;
  }
  addSamples(urls: Record<string, string>): void {
    for (const name of Object.keys(urls)) this.registered.add(name);
  }
  want(names: Iterable<string>): void {
    for (const name of names) this.wanted.add(name);
  }
}
