export class Pools {
  private readonly used = new Map<string, number>();

  constructor(private readonly limits: (pool: string) => number | null) {}

  tryTake(pools: string[]): boolean {
    for (const p of pools) {
      const limit = this.limits(p);
      if (limit !== null && (this.used.get(p) ?? 0) >= limit) return false;
    }
    for (const p of pools) this.used.set(p, (this.used.get(p) ?? 0) + 1);
    return true;
  }

  release(pools: string[]): void {
    for (const p of pools) {
      const n = (this.used.get(p) ?? 0) - 1;
      if (n <= 0) this.used.delete(p);
      else this.used.set(p, n);
    }
  }

  inUse(pool: string): number {
    return this.used.get(pool) ?? 0;
  }
}
