/**
 * 3CX CRM Integration Template routes.
 *
 * Native 3CX feature (Admin Console -> Integrations -> CRM), configured by
 * uploading 3cx-4d-emr-crm-template.xml. Two scenarios point here:
 *
 *   Lookup     GET  /crm/lookup?phoneNumber=[Number]&callId=[CallID]
 *              Fires synchronously on every call; 3CX must get a response
 *              within ~2s. Returns ContactUrl so 3CX opens it for the agent
 *              natively -- no browser extension needed. For a single matched
 *              patient, ContactUrl points at our own /crm/patient-summary
 *              page (see below) instead of straight at 4D EMR's web app --
 *              4D EMR's session is scoped to a per-tab TabId in
 *              sessionStorage with no return-to-URL after login, so a fresh
 *              tab opened by 3CX always hits their login screen. 4D EMR
 *              support confirmed (2026-07-27) this is deliberate (no SSO,
 *              citing HIPAA) and pointed to Weave's approach -- pull patient
 *              data via the API, render it yourself -- as the supported
 *              pattern. That's what /crm/patient-summary does.
 *
 *   ReportCall POST /crm/report-call
 *              Fires when a call ends. Carries 3CX's own [Transcription]
 *              and [Summary] tokens (populated by 3CX Enterprise call
 *              transcription). Pushes the note via pushCallTranscript() --
 *              matched patient -> chart note; no match -> 4D EMR lead note
 *              (same dispatcher used by the /webhooks/3cx/call-end path).
 *
 * Independent of the /webhooks/3cx/* routes used by Call Flow Designer --
 * both write into the same CallSessionStore keyed by callId, but neither
 * depends on the other having fired first. This avoids the timing race
 * that would exist if Lookup tried to read a session CFD's own webhook
 * hadn't created yet.
 *
 *   GET /crm/patient-summary?pid=&exp=&sig=
 *              Opened directly by the browser (not by 3CX server-to-server),
 *              so it can't carry the X-Api-Key header -- protected instead
 *              by a short-lived HMAC-signed token (see patientSummaryLink.js)
 *              so patient records aren't exposed via a guessable ?pid=NNN
 *              URL. Renders a read-only summary from data we already fetch
 *              server-side, with a link through to the real 4D EMR chart for
 *              when the agent needs to actually edit the record.
 */
import { Router } from "express";
import { normalizePhoneNumber } from "../utils.js";
import { sanitizeTranscriptText } from "../transcript/sanitizer.js";
import { resolveScreenPopAction, screenPopUrl } from "../screenPop.js";
import { createPatientSummaryUrl, verifyPatientSummaryToken } from "../patientSummaryLink.js";
import { renderPatientSummaryPage, renderLinkExpiredPage } from "../patientSummaryPage.js";

function requireApiKey(config) {
    return (req, res, next) => {
        if (!config.crmTemplateApiKey) {
            return next(); // no key configured -- dev mode, matches webhook secret's optional pattern
        }
        const provided = req.get("x-api-key");
        if (provided !== config.crmTemplateApiKey) {
            return res.status(401).json({ error: "Invalid or missing API key" });
        }
        return next();
    };
}

function requestOrigin(req) {
    const proto = req.get("x-forwarded-proto") ?? req.protocol;
    const host = req.get("host");
    return `${proto}://${host}`;
}

// 3CX's ReportCall Message template splices [Transcription]/[Summary] text
// straight into the JSON body without escaping it, so a real transcript's raw
// control characters (newlines between speaker turns, etc.) make it invalid
// JSON. index.js excludes this route from the global body parser so we can
// read the raw stream and sanitize it ourselves instead of 500ing before the
// route even runs.
const CONTROL_CHAR_PATTERN = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + "]", "g");
function sanitizeControlCharsInJsonString(raw) {
    return raw.replace(CONTROL_CHAR_PATTERN, (ch) => {
        switch (ch) {
            case "\n": return "\\n";
            case "\r": return "\\r";
            case "\t": return "\\t";
            default: return "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
        }
    });
}
function readReportCallBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let parsed = {};
            try {
                parsed = raw ? JSON.parse(raw) : {};
            }
            catch {
                try {
                    parsed = raw ? JSON.parse(sanitizeControlCharsInJsonString(raw)) : {};
                }
                catch {
                    parsed = {};
                }
            }
            resolve({ raw, body: parsed });
        });
        req.on("error", () => resolve({ raw: undefined, body: {} }));
    });
}

export function createCrmRouter(deps) {
    const router = Router();

    router.get("/lookup", requireApiKey(deps.config), async (req, res) => {
        const rawPhone = String(req.query.phoneNumber ?? req.query.Number ?? "");
        const callId = String(req.query.callId ?? req.query.CallID ?? "");
        if (!rawPhone) {
            return res.status(400).json({ error: "phoneNumber is required" });
        }
        const fromNumber = normalizePhoneNumber(rawPhone);

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

            if (callId) {
                deps.callSessions.upsertStartEvent({
                    callId,
                    fromNumber,
                    direction: "unknown",
                    startedAt: new Date().toISOString(),
                    patient,
                    patientMatches,
                    screenPopAction: resolvedAction.action,
                    screenPopUrl: resolvedAction.url,
                    metadata: { source: "crm-template-lookup", patientMatchCount: patients.length }
                });
            }

            // A specific patient was matched -- point ContactUrl at our own
            // summary page instead of straight into 4D EMR's web app (see
            // file header). Ambiguous/no matches keep the old behavior
            // (search / new-patient / none) since there's no single patient
            // to summarize.
            const contactUrl = patient
                ? createPatientSummaryUrl(deps.config, requestOrigin(req), patient.id)
                : (resolvedAction.url ?? "");

            const [firstName, ...lastParts] = (patient?.fullName ?? "").split(" ");
            return res.status(200).json({
                ContactId: patient?.id ?? "",
                ContactUrl: contactUrl,
                FirstName: firstName ?? "",
                LastName: lastParts.join(" "),
                CompanyName: "",
                PhoneBusiness: fromNumber,
                MRN: patient?.mrn ?? "",
                DOB: patient?.dateOfBirth ?? ""
            });
        }
        catch (error) {
            deps.logger.error({ err: error, callId, rawPhone }, "CRM lookup failed");
            // 3CX has no error scenario here -- respond empty so it degrades to no screen pop
            // rather than failing the call.
            return res.status(200).json({
                ContactId: "", ContactUrl: "", FirstName: "", LastName: "", CompanyName: "", PhoneBusiness: fromNumber
            });
        }
    });

    router.get("/patient-summary", async (req, res) => {
        const { pid, exp, sig } = req.query;
        res.set("Cache-Control", "no-store");
        res.set("X-Robots-Tag", "noindex, nofollow");

        if (!verifyPatientSummaryToken(deps.config, String(pid ?? ""), exp, sig)) {
            return res.status(410).type("html").send(renderLinkExpiredPage());
        }

        try {
            const patient = await deps.fourdEmrClient.getPatientById(pid);
            if (!patient) {
                return res.status(404).type("html").send(renderLinkExpiredPage());
            }
            let appointments = [];
            try {
                appointments = await deps.fourdEmrClient.getAppointmentsForPatient(pid);
            }
            catch (error) {
                deps.logger.warn({ err: error, patientId: pid }, "Failed to fetch appointments for patient summary");
            }
            const chartUrl = screenPopUrl(deps.config, patient.id) ?? `${deps.config.fourdEmrAppBaseUrl}/#`;
            return res.status(200).type("html").send(renderPatientSummaryPage({ patient, appointments, chartUrl }));
        }
        catch (error) {
            deps.logger.error({ err: error, patientId: pid }, "Failed to render patient summary page");
            return res.status(502).type("html").send(renderLinkExpiredPage());
        }
    });

    router.post("/report-call", requireApiKey(deps.config), async (req, res) => {
        res.status(200).json({ received: true }); // ack immediately, ReportCall has no error scenario

        const { raw, body } = await readReportCallBody(req);
        const b = body ?? {};
        const callerNumber = String(b.callerNumber ?? "");
        const transcript = [b.transcription, b.summary].filter(Boolean).join("\n\n---\n\nSummary:\n");
        if (!transcript) {
            deps.logger.warn({ hasTranscript: false, contentType: req.get("content-type"), rawBody: raw }, "ReportCall received with no transcript -- skipping");
            return;
        }
        // 3CX's [CallID] token comes through empty on this tenant (both Lookup and
        // ReportCall), so it can't be relied on for correlation/dedup -- fall back to
        // the recording URL (unique per call) or, failing that, a fresh synthetic id.
        const nativeCallId = String(b.callId ?? "");
        const recordingUrl = String(b.recordingUrl ?? "");
        const callId = nativeCallId || recordingUrl || `synthetic-${callerNumber || "unknown"}-${Date.now()}`;

        const eventId = `${callId}-report-call`;
        if (deps.processedEvents.has(eventId)) {
            return;
        }

        let session = deps.callSessions.get(callId);
        if (!session?.patient && callerNumber) {
            // Lookup scenario may not have fired for this call (e.g. outbound calls) --
            // do our own independent match so the note still lands somewhere. Runs
            // even on zero matches so fromNumber is captured for the lead fallback below.
            try {
                const patients = await deps.fourdEmrClient.findPatientsByPhone(normalizePhoneNumber(callerNumber));
                session = deps.callSessions.upsertStartEvent({
                    callId,
                    fromNumber: callerNumber,
                    direction: String(b.direction ?? "unknown"),
                    agentExtension: b.agent ? String(b.agent) : undefined,
                    startedAt: session?.startedAt ?? new Date().toISOString(),
                    patient: patients[0],
                    metadata: { source: "crm-template-report-call-fallback" }
                });
            }
            catch (error) {
                deps.logger.error({ err: error, callId }, "ReportCall fallback patient lookup failed");
            }
        }

        const fromNumber = session?.fromNumber ?? (callerNumber ? normalizePhoneNumber(callerNumber) : undefined);
        if (!fromNumber) {
            deps.logger.warn({ callId }, "ReportCall: no caller phone number available -- transcript not pushed to 4D EMR");
            deps.processedEvents.mark(eventId);
            return;
        }

        try {
            const sanitized = sanitizeTranscriptText(transcript, deps.config);
            const result = await deps.fourdEmrClient.pushCallTranscript({ ...session, callId, fromNumber }, sanitized);
            deps.callSessions.delete(callId);
            deps.processedEvents.mark(eventId);
            deps.logger.info({ callId, destination: result.destination, patientId: session?.patient?.id, leadId: result.leadId }, "CRM ReportCall transcript pushed to 4D EMR");
        }
        catch (error) {
            deps.logger.error({ err: error, callId, patientId: session?.patient?.id }, "Failed to push ReportCall transcript to 4D EMR");
        }
    });

    return router;
}
