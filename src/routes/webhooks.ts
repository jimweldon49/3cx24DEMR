import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Logger } from "pino";
import { FourdEmrClient } from "../clients/fourd-emr-client.js";
import type { PatientSummary, ScreenPopAction } from "../types.js";
import { EventIdStore } from "../services/event-id-store.js";
import { CallSessionStore } from "../services/call-session-store.js";
import { isSignatureValid } from "../security/signature.js";
import { asPositiveInt, normalizePhoneNumber } from "../utils.js";
import { sanitizeTranscriptText } from "../transcript/sanitizer.js";

type RouterDependencies = {
  config: AppConfig;
  logger: Logger;
  fourdEmrClient: FourdEmrClient;
  callSessions: CallSessionStore;
  processedEvents: EventIdStore;
};

type RequestWithRawBody = Request & { rawBody?: string };

const callStartSchema = z.object({
  eventId: z.string().optional(),
  eventType: z.string().optional(),
  callId: z.string().min(1),
  appointmentId: z.coerce.number().int().positive().optional(),
  fromNumber: z.string().min(3),
  toNumber: z.string().optional(),
  direction: z.enum(["inbound", "outbound"]).optional(),
  agentExtension: z.string().optional(),
  startedAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const transcriptSchema = z.object({
  eventId: z.string().optional(),
  callId: z.string().min(1),
  appointmentId: z.coerce.number().int().positive().optional(),
  transcript: z.string().min(1)
});

const callEndSchema = z.object({
  eventId: z.string().optional(),
  callId: z.string().min(1),
  appointmentId: z.coerce.number().int().positive().optional(),
  endedAt: z.string().datetime().optional(),
  transcript: z.string().optional()
});

function validateSignature(req: RequestWithRawBody, config: AppConfig): boolean {
  if (!config.threeCxWebhookSecret) {
    return true;
  }

  const signatureHeader = req.get("x-3cx-signature") ?? req.get("x-webhook-signature");
  if (!signatureHeader || !req.rawBody) {
    return false;
  }

  return isSignatureValid({
    secret: config.threeCxWebhookSecret,
    rawBody: req.rawBody,
    providedSignature: signatureHeader
  });
}

function screenPopUrl(config: AppConfig, patientId: string): string | undefined {
  return buildUrlFromTemplate(config, config.fourdMappings.screenPopPathTemplate, {
    patientId
  });
}

function searchUrl(config: AppConfig, phone: string): string | undefined {
  return buildUrlFromTemplate(config, config.fourdMappings.patientSearchPathTemplate, {
    phone
  });
}

function newPatientUrl(config: AppConfig, phone: string): string | undefined {
  return buildUrlFromTemplate(config, config.fourdMappings.newPatientPathTemplate, {
    phone
  });
}

function buildUrlFromTemplate(
  config: AppConfig,
  template: string | undefined,
  values: Record<string, string | undefined>
): string | undefined {
  if (!template) {
    return undefined;
  }

  let url = template;
  for (const [key, rawValue] of Object.entries(values)) {
    url = url.replaceAll(`{${key}}`, encodeURIComponent(rawValue ?? ""));
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return `${config.fourdEmrAppBaseUrl}${url}`;
}

function appHomeUrl(config: AppConfig): string {
  return `${config.fourdEmrAppBaseUrl}/#`;
}

function summarizePatient(patient: PatientSummary): Record<string, string | undefined> {
  return {
    id: patient.id,
    fullName: patient.fullName,
    mrn: patient.mrn,
    dateOfBirth: patient.dateOfBirth,
    chartNumber: patient.chartNumber
  };
}

function rejectInvalidSignature(res: Response): void {
  res.status(401).json({
    error: "Invalid webhook signature"
  });
}

function resolveScreenPopAction(input: {
  config: AppConfig;
  patientCount: number;
  selectedPatient?: PatientSummary;
  fromNumber: string;
}): { action: ScreenPopAction; url?: string } {
  const { config, patientCount, selectedPatient, fromNumber } = input;

  if (patientCount === 1 && selectedPatient) {
    const url = screenPopUrl(config, selectedPatient.id);
    return url ? { action: "open_patient", url } : { action: "none" };
  }

  if (patientCount > 1) {
    if (config.screenPopBehavior.multiMatchAction === "open_first" && selectedPatient) {
      const url = screenPopUrl(config, selectedPatient.id);
      return url ? { action: "open_patient", url } : { action: "none" };
    }

    if (config.screenPopBehavior.multiMatchAction === "search") {
      const url = searchUrl(config, fromNumber);
      return { action: "search", url: url ?? appHomeUrl(config) };
    }

    const url = searchUrl(config, fromNumber);
    return { action: "pick_list", url };
  }

  if (config.screenPopBehavior.noMatchAction === "new_patient") {
    const url = newPatientUrl(config, fromNumber);
    return { action: "new_patient", url: url ?? appHomeUrl(config) };
  }
  if (config.screenPopBehavior.noMatchAction === "search") {
    const url = searchUrl(config, fromNumber);
    return { action: "search", url: url ?? appHomeUrl(config) };
  }

  return { action: "none" };
}

export function createWebhookRouter(deps: RouterDependencies): Router {
  const router = Router();

  router.post("/3cx/call-start", async (req: RequestWithRawBody, res) => {
    if (!validateSignature(req, deps.config)) {
      return rejectInvalidSignature(res);
    }

    const parsed = callStartSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid payload",
        details: parsed.error.flatten()
      });
    }

    const payload = parsed.data;
    if (payload.eventId && deps.processedEvents.has(payload.eventId)) {
      return res.status(200).json({ status: "duplicate", callId: payload.callId });
    }

    const fromNumber = normalizePhoneNumber(payload.fromNumber);
    const direction = payload.direction ?? "unknown";
    const startedAt = payload.startedAt ?? new Date().toISOString();
    const appointmentId =
      payload.appointmentId ?? asPositiveInt((payload.metadata as Record<string, unknown> | undefined)?.appointmentId);

    try {
      const patients = await deps.fourdEmrClient.findPatientsByPhone(fromNumber);
      let patient: PatientSummary | undefined;
      let patientMatches: PatientSummary[] | undefined;

      if (patients.length === 1) {
        patient = patients[0];
      } else if (patients.length > 1) {
        patientMatches = patients.slice(0, 10);
        if (deps.config.screenPopBehavior.multiMatchAction === "open_first") {
          patient = patients[0];
        }
      }
      const resolvedAction = resolveScreenPopAction({
        config: deps.config,
        patientCount: patients.length,
        selectedPatient: patient,
        fromNumber
      });

      const session = deps.callSessions.upsertStartEvent({
        callId: payload.callId,
        eventId: payload.eventId,
        appointmentId,
        fromNumber,
        toNumber: payload.toNumber,
        direction,
        agentExtension: payload.agentExtension,
        startedAt,
        patient,
        patientMatches,
        screenPopAction: resolvedAction.action,
        screenPopUrl: resolvedAction.url,
        metadata: {
          ...(payload.metadata ?? {}),
          integration: {
            patientMatchCount: patients.length,
            screenPopAction: resolvedAction.action
          }
        }
      });

      if (payload.eventId) {
        deps.processedEvents.mark(payload.eventId);
      }

      return res.status(200).json({
        status: "ok",
        callId: payload.callId,
        screenPopAction: session.screenPopAction ?? "none",
        matchCount: patients.length,
        patientFound: Boolean(session.patient),
        patient: session.patient ? summarizePatient(session.patient) : null,
        matchCandidates: (session.patientMatches ?? []).map((entry) => summarizePatient(entry)),
        screenPopUrl: session.screenPopUrl ?? null
      });
    } catch (error) {
      deps.logger.error({ err: error, callId: payload.callId }, "Failed to process call-start event");
      return res.status(502).json({
        error: "Unable to process call-start event"
      });
    }
  });

  router.post("/3cx/transcript", async (req: RequestWithRawBody, res) => {
    if (!validateSignature(req, deps.config)) {
      return rejectInvalidSignature(res);
    }

    const parsed = transcriptSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid payload",
        details: parsed.error.flatten()
      });
    }

    const payload = parsed.data;
    if (payload.eventId && deps.processedEvents.has(payload.eventId)) {
      return res.status(200).json({ status: "duplicate", callId: payload.callId });
    }

    const session = deps.callSessions.upsertTranscript(payload.callId, payload.transcript);
    if (payload.eventId) {
      deps.processedEvents.mark(payload.eventId);
    }

    if (!session) {
      deps.logger.warn({ callId: payload.callId }, "Transcript received before call session was created");
      return res.status(202).json({
        status: "accepted",
        callId: payload.callId,
        message: "Transcript stored request accepted but no active call session found yet"
      });
    }

    return res.status(200).json({
      status: "ok",
      callId: payload.callId
    });
  });

  router.post("/3cx/call-end", async (req: RequestWithRawBody, res) => {
    if (!validateSignature(req, deps.config)) {
      return rejectInvalidSignature(res);
    }

    const parsed = callEndSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid payload",
        details: parsed.error.flatten()
      });
    }

    const payload = parsed.data;
    if (payload.eventId && deps.processedEvents.has(payload.eventId)) {
      return res.status(200).json({ status: "duplicate", callId: payload.callId });
    }

    const session = deps.callSessions.get(payload.callId);
    if (!session) {
      deps.logger.warn({ callId: payload.callId }, "call-end received with no active call session");
      if (payload.eventId) {
        deps.processedEvents.mark(payload.eventId);
      }
      return res.status(202).json({
        status: "accepted",
        callId: payload.callId,
        pushedToEmr: false,
        message: "No active call session found for callId"
      });
    }

    const transcript = payload.transcript ?? session.transcript;
    if (payload.transcript) {
      deps.callSessions.upsertTranscript(payload.callId, payload.transcript);
    }
      if (payload.appointmentId) {
        deps.callSessions.upsertStartEvent({
          callId: payload.callId,
          appointmentId: payload.appointmentId,
          fromNumber: session.fromNumber,
          toNumber: session.toNumber,
          direction: session.direction,
          agentExtension: session.agentExtension,
          startedAt: session.startedAt,
          patient: session.patient,
          patientMatches: session.patientMatches,
          screenPopAction: session.screenPopAction,
          screenPopUrl: session.screenPopUrl,
          metadata: session.metadata
        });
      }

    try {
      let pushedToEmr = false;
      let redactionsApplied = false;
      let pushSkippedReason: string | undefined;
      if (session.patient && transcript) {
        const appointmentId = payload.appointmentId ?? session.appointmentId;
        const sanitizedTranscript = sanitizeTranscriptText(transcript, deps.config);
        redactionsApplied = sanitizedTranscript !== transcript;
        await deps.fourdEmrClient.appendTranscriptToPatientChart(
          { ...session, appointmentId },
          sanitizedTranscript
        );
        pushedToEmr = true;
      } else if (!session.patient) {
        pushSkippedReason = "patient_not_found";
      } else if (!transcript) {
        pushSkippedReason = "transcript_missing";
      }

      deps.callSessions.delete(payload.callId);
      if (payload.eventId) {
        deps.processedEvents.mark(payload.eventId);
      }

      return res.status(200).json({
        status: "ok",
        callId: payload.callId,
        patientId: session.patient?.id ?? null,
        appointmentId: payload.appointmentId ?? session.appointmentId ?? null,
        transcriptPresent: Boolean(transcript),
        redactionsApplied,
        pushSkippedReason: pushSkippedReason ?? null,
        pushedToEmr
      });
    } catch (error) {
      deps.logger.error(
        { err: error, callId: payload.callId, patientId: session.patient?.id },
        "Failed to push transcript to 4D EMR"
      );
      return res.status(502).json({
        error: "Unable to push transcript to 4D EMR"
      });
    }
  });

  router.get("/screen-pop/:callId", (req, res) => {
    const { callId } = req.params;
    const session = deps.callSessions.get(callId);
    if (!session) {
      return res.status(404).json({
        error: "No call context found",
        callId
      });
    }

    return res.status(200).json({
      callId,
      screenPopAction: session.screenPopAction ?? "none",
      patient: session.patient ? summarizePatient(session.patient) : null,
      matchCandidates: (session.patientMatches ?? []).map((entry) => summarizePatient(entry)),
      screenPopUrl: session.screenPopUrl ?? null
    });
  });

  return router;
}
