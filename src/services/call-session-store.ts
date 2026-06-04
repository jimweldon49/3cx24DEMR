import type { CallSession, PatientSummary } from "../types.js";

export class CallSessionStore {
  private readonly sessions = new Map<string, CallSession>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  upsertStartEvent(input: {
    callId: string;
    eventId?: string;
    fromNumber: string;
    toNumber?: string;
    direction: "inbound" | "outbound" | "unknown";
    agentExtension?: string;
    startedAt: string;
    patient?: PatientSummary;
    metadata?: Record<string, unknown>;
  }): CallSession {
    this.pruneExpired();

    const existing = this.sessions.get(input.callId);
    const now = Date.now();
    const next: CallSession = {
      ...(existing ?? {}),
      callId: input.callId,
      eventId: input.eventId ?? existing?.eventId,
      fromNumber: input.fromNumber,
      toNumber: input.toNumber,
      direction: input.direction,
      agentExtension: input.agentExtension,
      startedAt: input.startedAt,
      patient: input.patient ?? existing?.patient,
      metadata: input.metadata ?? existing?.metadata,
      transcript: existing?.transcript,
      expiresAt: now + this.ttlMs
    };

    this.sessions.set(input.callId, next);
    return next;
  }

  upsertTranscript(callId: string, transcript: string): CallSession | undefined {
    this.pruneExpired();

    const existing = this.sessions.get(callId);
    if (!existing) {
      return undefined;
    }

    const updated: CallSession = {
      ...existing,
      transcript,
      expiresAt: Date.now() + this.ttlMs
    };

    this.sessions.set(callId, updated);
    return updated;
  }

  get(callId: string): CallSession | undefined {
    this.pruneExpired();
    return this.sessions.get(callId);
  }

  delete(callId: string): void {
    this.sessions.delete(callId);
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [callId, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(callId);
      }
    }
  }
}
