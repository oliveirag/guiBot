const PRUNE_AT = 5_000;

export class Cooldowns {
  private readonly expires = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Returns seconds left if `key` is cooling down, otherwise records the hit and returns 0. */
  hit(key: string, seconds: number): number {
    const t = this.now();
    const until = this.expires.get(key);
    if (until !== undefined && until > t) return Math.ceil((until - t) / 1000);
    if (this.expires.size > PRUNE_AT) {
      for (const [k, v] of this.expires) if (v <= t) this.expires.delete(k);
    }
    this.expires.set(key, t + seconds * 1000);
    return 0;
  }
}
