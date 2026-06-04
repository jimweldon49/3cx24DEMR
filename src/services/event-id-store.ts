export class EventIdStore {
  private readonly processed = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  has(eventId: string): boolean {
    this.pruneExpired();
    return this.processed.has(eventId);
  }

  mark(eventId: string): void {
    this.pruneExpired();
    this.processed.set(eventId, Date.now() + this.ttlMs);
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [eventId, expiresAt] of this.processed.entries()) {
      if (expiresAt <= now) {
        this.processed.delete(eventId);
      }
    }
  }
}
