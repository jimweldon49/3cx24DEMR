export type PatientSummary = {
  id: string;
  fullName: string;
  mrn?: string;
  dateOfBirth?: string;
  chartNumber?: string;
  raw: unknown;
};

export type CallSession = {
  callId: string;
  eventId?: string;
  fromNumber: string;
  toNumber?: string;
  direction: "inbound" | "outbound" | "unknown";
  agentExtension?: string;
  startedAt: string;
  patient?: PatientSummary;
  transcript?: string;
  metadata?: Record<string, unknown>;
  expiresAt: number;
};
