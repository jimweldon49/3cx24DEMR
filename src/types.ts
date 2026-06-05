export type PatientSummary = {
  id: string;
  fullName: string;
  mrn?: string;
  dateOfBirth?: string;
  chartNumber?: string;
  raw: unknown;
};

export type ScreenPopAction = "open_patient" | "pick_list" | "new_patient" | "search" | "none";

export type CallSession = {
  callId: string;
  eventId?: string;
  fromNumber: string;
  toNumber?: string;
  direction: "inbound" | "outbound" | "unknown";
  agentExtension?: string;
  startedAt: string;
  patient?: PatientSummary;
  patientMatches?: PatientSummary[];
  screenPopAction?: ScreenPopAction;
  screenPopUrl?: string;
  transcript?: string;
  metadata?: Record<string, unknown>;
  expiresAt: number;
};
