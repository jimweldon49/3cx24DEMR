import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Logger } from "pino";
import { FourdEmrClient } from "../clients/fourd-emr-client.js";
import { getByPath, asString, normalizePhoneNumber } from "../utils.js";
import { sanitizeTranscriptText } from "../transcript/sanitizer.js";
import { appHomeUrl, newPatientUrl, screenPopUrl, searchUrl } from "../screen-pop.js";

type RouterDependencies = {
  config: AppConfig;
  logger: Logger;
  fourdEmrClient: FourdEmrClient;
};

const lookupQuerySchema = z.object({
  phoneNumber: z.string().min(3),
  callId: z.string().optional()
});

const journalBodySchema = z.object({
  callId: z.string().optional(),
  callerNumber: z.string().optional(),
  agent: z.string().optional(),
  direction: z.string().optional(),
  duration: z.union([z.string(), z.number()]).optional(),
  entityId: z.string().optional(),
  callText: z.string().optional(),
  transcription: z.string().optional(),
  summary: z.string().optional(),
  recordingUrl: z.string().optional()
});

function isApiKeyValid(req: Request, config: AppConfig): boolean {
  if (!config.apiKey) {
    return true;
  }

  return req.get("x-api-key") === config.apiKey;
}

function normalizeDirection(direction: string | undefined): "inbound" | "outbound" | "unknown" {
  const value = direction?.toLowerCase();
  if (value === "inbound" || value === "outbound") {
    return value;
  }
  return "unknown";
}

export function createCrmRouter(deps: RouterDependencies): Router {
  const router = Router();

  router.get("/lookup", async (req: Request, res: Response) => {
    if (!isApiKeyValid(req, deps.config)) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    const parsed = lookupQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const fromNumber = normalizePhoneNumber(parsed.data.phoneNumber);

    try {
      const patients = await deps.fourdEmrClient.findPatientsByPhone(fromNumber);
      const multiMatchAction = deps.config.screenPopBehavior.multiMatchAction;
      const patient =
        patients.length === 1
          ? patients[0]
          : patients.length > 1 && multiMatchAction === "open_first"
            ? patients[0]
            : undefined;

      if (patient) {
        const firstNamePath = deps.config.fourdMappings.patientFirstNamePath;
        const lastNamePath = deps.config.fourdMappings.patientLastNamePath;
        return res.status(200).json({
          ContactId: patient.id,
          ContactUrl: screenPopUrl(deps.config, patient.id) ?? appHomeUrl(deps.config),
          FirstName: asString(getByPath(patient.raw, firstNamePath)) ?? "",
          LastName: asString(getByPath(patient.raw, lastNamePath)) ?? "",
          CompanyName: "",
          PhoneBusiness: fromNumber
        });
      }

      const fallbackUrl =
        patients.length > 1
          ? (searchUrl(deps.config, fromNumber) ?? appHomeUrl(deps.config))
          : deps.config.screenPopBehavior.noMatchAction === "new_patient"
            ? (newPatientUrl(deps.config, fromNumber) ?? appHomeUrl(deps.config))
            : deps.config.screenPopBehavior.noMatchAction === "search"
              ? (searchUrl(deps.config, fromNumber) ?? appHomeUrl(deps.config))
              : appHomeUrl(deps.config);

      return res.status(200).json({
        ContactId: "",
        ContactUrl: fallbackUrl,
        FirstName: "",
        LastName: "",
        CompanyName: "",
        PhoneBusiness: fromNumber
      });
    } catch (error) {
      deps.logger.error({ err: error, fromNumber }, "Failed to look up patient for CRM lookup");
      return res.status(502).json({ error: "Unable to look up patient" });
    }
  });

  router.post("/journal", async (req: Request, res: Response) => {
    if (!isApiKeyValid(req, deps.config)) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    const parsed = journalBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const payload = parsed.data;
    const transcript = payload.transcription || payload.callText;

    if (!payload.entityId || !transcript) {
      return res.status(200).json({
        status: "skipped",
        pushedToEmr: false,
        reason: !payload.entityId ? "entity_id_missing" : "transcript_missing"
      });
    }

    const noteLines = [
      "Source: 3CX v20",
      payload.callId ? `Call ID: ${payload.callId}` : undefined,
      `Direction: ${normalizeDirection(payload.direction)}`,
      payload.callerNumber ? `Caller: ${normalizePhoneNumber(payload.callerNumber)}` : undefined,
      payload.agent ? `Agent Extension: ${payload.agent}` : undefined,
      payload.duration !== undefined ? `Duration (s): ${payload.duration}` : undefined,
      payload.recordingUrl ? `Recording: ${payload.recordingUrl}` : undefined
    ].filter((line): line is string => Boolean(line));

    const sanitizedTranscript = sanitizeTranscriptText(transcript, deps.config);
    const noteSections = [noteLines.join("\n"), `Transcript:\n${sanitizedTranscript}`];
    if (payload.summary) {
      noteSections.push(`Summary:\n${sanitizeTranscriptText(payload.summary, deps.config)}`);
    }

    try {
      await deps.fourdEmrClient.createChartNoteForPatient({
        patientId: payload.entityId,
        noteText: noteSections.join("\n\n")
      });

      return res.status(200).json({ status: "ok", pushedToEmr: true });
    } catch (error) {
      deps.logger.error(
        { err: error, callId: payload.callId, entityId: payload.entityId },
        "Failed to push call journal to 4D EMR"
      );
      return res.status(502).json({ error: "Unable to push call journal to 4D EMR" });
    }
  });

  return router;
}
