export class CallSessionStore {
    sessions = new Map();
    ttlMs;
    constructor(ttlMs) {
        this.ttlMs = ttlMs;
    }
    upsertStartEvent(input) {
        this.pruneExpired();
        const existing = this.sessions.get(input.callId);
        const now = Date.now();
        const next = {
            ...(existing ?? {}),
            callId: input.callId,
            eventId: input.eventId ?? existing?.eventId,
            appointmentId: input.appointmentId ?? existing?.appointmentId,
            fromNumber: input.fromNumber,
            toNumber: input.toNumber,
            direction: input.direction,
            agentExtension: input.agentExtension,
            startedAt: input.startedAt,
            patient: input.patient ?? existing?.patient,
            patientMatches: input.patientMatches ?? existing?.patientMatches,
            screenPopAction: input.screenPopAction ?? existing?.screenPopAction,
            screenPopUrl: input.screenPopUrl ?? existing?.screenPopUrl,
            metadata: input.metadata ?? existing?.metadata,
            transcript: existing?.transcript,
            expiresAt: now + this.ttlMs
        };
        this.sessions.set(input.callId, next);
        return next;
    }
    upsertTranscript(callId, transcript) {
        this.pruneExpired();
        const existing = this.sessions.get(callId);
        if (!existing) {
            return undefined;
        }
        const updated = {
            ...existing,
            transcript,
            expiresAt: Date.now() + this.ttlMs
        };
        this.sessions.set(callId, updated);
        return updated;
    }
    get(callId) {
        this.pruneExpired();
        return this.sessions.get(callId);
    }
    delete(callId) {
        this.sessions.delete(callId);
    }
    pruneExpired() {
        const now = Date.now();
        for (const [callId, session] of this.sessions.entries()) {
            if (session.expiresAt <= now) {
                this.sessions.delete(callId);
            }
        }
    }
}
