import { Router } from "express";
import { z } from "zod";
import { isSignatureValid } from "../security/signature.js";
import { asPositiveInt, normalizePhoneNumber } from "../utils.js";
import { sanitizeTranscriptText } from "../transcript/sanitizer.js";
import { resolveScreenPopAction, summarizePatient } from "../screenPop.js";

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

function validateSignature(req, config) {
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

function rejectInvalidSignature(res) {
    res.status(401).json({ error: "Invalid webhook signature" });
}

export function createWebhookRouter(deps) {
    const router = Router();

    router.post("/3cx/call-start", async (req, res) => {
        if (!validateSignature(req, deps.config)) {
            return rejectInvalidSignature(res);
        }
        const parsed = callStartSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
        }
        const payload = parsed.data;
        if (payload.eventId && deps.processedEvents.has(payload.eventId)) {
            return res.status(200).json({ status: "duplicate", callId: payload.callId });
        }
        const fromNumber = normalizePhoneNumber(payload.fromNumber);
        const direction = payload.direction ?? "unknown";
        const startedAt = payload.startedAt ?? new Date().toISOString();
        const appointmentId = payload.appointmentId ?? asPositiveInt(payload.metadata?.appointmentId);
        try {
            const patients = await deps.fourdEmrClient.findPatientsByPhone(fromNumber);
            let patient;
            let patientMatches;
            if (patients.length === 1) {
                patient = patients[0];
            }
            else if (patients.length > 1) {
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
        }
        catch (error) {
            deps.logger.error({ err: error, callId: payload.callId }, "Failed to process call-start event");
            return res.status(502).json({ error: "Unable to process call-start event" });
        }
    });

    router.post("/3cx/transcript", async (req, res) => {
        if (!validateSignature(req, deps.config)) {
            return rejectInvalidSignature(res);
        }
        const parsed = transcriptSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
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
        return res.status(200).json({ status: "ok", callId: payload.callId });
    });

    router.post("/3cx/call-end", async (req, res) => {
        if (!validateSignature(req, deps.config)) {
            return rejectInvalidSignature(res);
        }
        const parsed = callEndSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
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
            let pushSkippedReason;
            let pushResult;
            if (transcript) {
                const appointmentId = payload.appointmentId ?? session.appointmentId;
                const sanitizedTranscript = sanitizeTranscriptText(transcript, deps.config);
                redactionsApplied = sanitizedTranscript !== transcript;
                pushResult = await deps.fourdEmrClient.pushCallTranscript({ ...session, appointmentId }, sanitizedTranscript);
                pushedToEmr = true;
            }
            else {
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
                pushedToEmr,
                pushDestination: pushResult?.destination ?? null,
                leadId: pushResult?.leadId ?? null
            });
        }
        catch (error) {
            deps.logger.error({ err: error, callId: payload.callId, patientId: session.patient?.id }, "Failed to push transcript to 4D EMR");
            return res.status(502).json({ error: "Unable to push transcript to 4D EMR" });
        }
    });

    router.get("/screen-pop/:callId", (req, res) => {
        const { callId } = req.params;
        const session = deps.callSessions.get(callId);
        if (!session) {
            return res.status(404).json({ error: "No call context found", callId });
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
