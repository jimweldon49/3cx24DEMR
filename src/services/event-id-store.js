export class EventIdStore {
    processed = new Map();
    ttlMs;
    constructor(ttlMs) {
        this.ttlMs = ttlMs;
    }
    has(eventId) {
        this.pruneExpired();
        return this.processed.has(eventId);
    }
    mark(eventId) {
        this.pruneExpired();
        this.processed.set(eventId, Date.now() + this.ttlMs);
    }
    pruneExpired() {
        const now = Date.now();
        for (const [eventId, expiresAt] of this.processed.entries()) {
            if (expiresAt <= now) {
                this.processed.delete(eventId);
            }
        }
    }
}
