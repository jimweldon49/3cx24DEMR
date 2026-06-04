import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Logger } from "pino";
import { FourdEmrClient } from "../clients/fourd-emr-client.js";
import { EventIdStore } from "../services/event-id-store.js";
import { CallSessionStore } from "../services/call-session-store.js";
import { isSignatureValid } from "../security/signature.js";
import { normalizePhoneNumber } from "../utils.js";

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
  transcript: z.string().min(1)
});

const callEndSchema = z.object({
  eventId: z.string().optional(),
  callId: z.string().min(1),
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

function screenPopUrl(config: AppConfig, patientId: string): string {
  const path = config.fourdMappings.screenPopPathTemplate.replace(
    "{patientId}",
    encodeURIComponent(patientId)
  );
  return `${config.fourdEmrBaseUrl}${path}`;
}

function rejectInvalidSignature(res: Response): void {
  res.status(401).json({
    error: "Invalid webhook signature"
  });
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

    try {
      const patient = await deps.fourdEmrClient.findPatientByPhone(fromNumber);
      const session = deps.callSessions.upsertStartEvent({
        callId: payload.callId,
        eventId: payload.eventId,
        fromNumber,
        toNumber: payload.toNumber,
        direction,
        agentExtension: payload.agentExtension,
        startedAt,
        patient,
        metadata: payload.metadata
      });

      if (payload.eventId) {
        deps.processedEvents.mark(payload.eventId);
      }

      return res.status(200).json({
        status: "ok",
        callId: payload.callId,
        patientFound: Boolean(session.patient),
        patient: session.patient
          ? {
              id: session.patient.id,
              fullName: session.patient.fullName,
              mrn: session.patient.mrn,
              dateOfBirth: session.patient.dateOfBirth
            }
          : null,
        screenPopUrl: session.patient ? screenPopUrl(deps.config, session.patient.id) : null
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

    try {
      let pushedToEmr = false;
      if (session.patient && transcript) {
        await deps.fourdEmrClient.appendTranscriptToPatientChart(session, transcript);
        pushedToEmr = true;
      }

      deps.callSessions.delete(payload.callId);
      if (payload.eventId) {
        deps.processedEvents.mark(payload.eventId);
      }

      return res.status(200).json({
        status: "ok",
        callId: payload.callId,
        patientId: session.patient?.id ?? null,
        transcriptPresent: Boolean(transcript),
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
    if (!session || !session.patient) {
      return res.status(404).json({
        error: "No patient context found for call",
        callId
      });
    }

    return res.status(200).json({
      callId,
      patient: {
        id: session.patient.id,
        fullName: session.patient.fullName,
        mrn: session.patient.mrn,
        dateOfBirth: session.patient.dateOfBirth,
        chartNumber: session.patient.chartNumber
      },
      screenPopUrl: screenPopUrl(deps.config, session.patient.id)
    });
  });

  return router;
}
