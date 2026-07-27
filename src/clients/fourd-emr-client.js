import axios, { AxiosHeaders } from "axios";
import { asPositiveInt, asString, getByPath } from "../utils.js";

export class FourdEmrClient {
    http;
    config;
    logger;
    leadIdStore;
    oauthTokenCache;
    oauthTokenPromise;
    constructor(config, logger, leadIdStore) {
        this.config = config;
        this.logger = logger;
        this.leadIdStore = leadIdStore;
        this.http = axios.create({
            baseURL: config.fourdEmrBaseUrl,
            timeout: 15_000,
            headers: {
                "Content-Type": "application/json",
                ...this.staticAuthHeaders()
            }
        });
        this.http.interceptors.request.use(async (requestConfig) => {
            const headers = await this.dynamicAuthHeaders();
            const resolvedHeaders = AxiosHeaders.from(requestConfig.headers ?? {});
            for (const [key, value] of Object.entries(headers)) {
                resolvedHeaders.set(key, value);
            }
            requestConfig.headers = resolvedHeaders;
            return requestConfig;
        });
    }
    async findPatientsByPhone(phoneNumber) {
        const endpoint = this.config.fourdMappings.patientLookupPath;
        const queryParam = this.config.fourdMappings.patientLookupPhoneParam;
        const attemptedNumbers = this.lookupPhoneCandidates(phoneNumber);
        for (const candidate of attemptedNumbers) {
            const response = await this.http.get(endpoint, {
                params: {
                    [queryParam]: candidate,
                    "page.count": this.config.fourdMappings.patientLookupPageCount,
                    "page.skip": this.config.fourdMappings.patientLookupPageSkip,
                    "page.NeedTotalCount": this.config.fourdMappings.patientLookupNeedTotalCount
                }
            });
            const results = getByPath(response.data, this.config.fourdMappings.patientLookupResultPath);
            const list = Array.isArray(results) ? results : results != null ? [results] : [];
            if (list.length === 0) {
                continue;
            }
            const mapped = list.flatMap((entry) => {
                const summary = this.mapPatientSummary(entry);
                return summary ? [summary] : [];
            });
            if (mapped.length > 0) {
                return mapped;
            }
        }
        return [];
    }
    // Direct fetch by patient id -- used by the patient-summary popup page, which
    // already knows the id (from a signed link) and doesn't need phone matching.
    async getPatientById(patientId) {
        const response = await this.http.get(`${this.config.fourdMappings.patientLookupPath}/${patientId}`);
        return this.mapPatientSummary(response.data);
    }
    async getAppointmentsForPatient(patientId) {
        const endpoint = this.config.fourdMappings.appointmentLookupPath;
        const param = this.config.fourdMappings.appointmentLookupPatientIdParam;
        const response = await this.http.get(endpoint, { params: { [param]: patientId } });
        const results = getByPath(response.data, "Items");
        return Array.isArray(results) ? results : [];
    }
    // Chart notes (ChartNoteTypeID) don't land in a category visible in 4D EMR's
    // UI regardless of the type id sent -- confirmed both by inspection (every
    // note this integration ever wrote reads back as Type 12, never the intended
    // Type 2, "telephone") and by 4D EMR support (2026-07-27), who pointed to the
    // Leads endpoints as the correct place to push call info/notes -- for every
    // caller, not just unmatched ones. So all call transcripts, matched patient
    // or not, go through the same find-or-create-lead + append-note path. 4D EMR's
    // Leads API has no lookup-by-phone or lookup-by-id (confirmed by exhaustive
    // testing), so leadIdStore (Table Storage) remembers the LeadId we get back
    // from Lead-Create ourselves -- both to reuse it for repeat callers and so
    // the patient-summary page can pull previous call notes back later.
    async findOrCreateLeadId(fromNumber, patientName) {
        const cached = await this.leadIdStore.get(fromNumber);
        if (cached) {
            return cached;
        }
        const [firstName, ...lastParts] = (patientName ?? "").trim().split(/\s+/).filter(Boolean);
        const endpoint = this.config.fourdMappings.leadCreatePath;
        const response = await this.http.post(endpoint, {
            FirstName: firstName || "Unknown",
            LastName: lastParts.length > 0 ? lastParts.join(" ") : fromNumber,
            Phone: fromNumber,
            ReferringSource: this.config.fourdMappings.leadReferringSource
        });
        const leadId = asPositiveInt(getByPath(response.data, "Id"));
        if (!leadId) {
            throw new Error("Lead-Create response did not include an Id");
        }
        await this.leadIdStore.set(fromNumber, leadId);
        return leadId;
    }
    async appendTranscriptToLead(session, transcript) {
        const leadId = await this.findOrCreateLeadId(session.fromNumber, session.patient?.fullName);
        const endpoint = this.config.fourdMappings.leadNoteCreatePath;
        await this.http.post(endpoint, {
            LeadId: leadId,
            Body: this.buildCallNoteText(session, transcript)
        });
        return leadId;
    }
    async pushCallTranscript(session, transcript) {
        if (!session.fromNumber) {
            throw new Error("Cannot push call transcript without a caller phone number");
        }
        const leadId = await this.appendTranscriptToLead(session, transcript);
        return { destination: "lead_note", leadId, patientId: session.patient?.id };
    }
    // Used by the patient-summary popup to show previous call history. Returns
    // [] (rather than throwing) if this phone number has never had a lead
    // created for it -- that's a normal first-call case, not an error.
    async getPreviousCallNotes(fromNumber) {
        const leadId = await this.leadIdStore.get(fromNumber);
        if (!leadId) {
            return [];
        }
        const endpoint = this.config.fourdMappings.leadNoteCreatePath;
        const response = await this.http.get(endpoint, { params: { leadId } });
        return Array.isArray(response.data) ? response.data : [];
    }
    buildCallNoteText(session, transcript) {
        const callSummaryLines = [
            "Source: 3CX v20",
            `Call ID: ${session.callId}`,
            `Direction: ${session.direction}`,
            `From: ${session.fromNumber}`,
            session.toNumber ? `To: ${session.toNumber}` : undefined,
            session.agentExtension ? `Agent Extension: ${session.agentExtension}` : undefined,
            `Call Started At: ${session.startedAt}`
        ].filter((line) => Boolean(line));
        return `${callSummaryLines.join("\n")}\n\nTranscript:\n${transcript}`;
    }
    staticAuthHeaders() {
        const headers = {};
        if (this.config.fourdEmrApiKey) {
            headers["x-api-key"] = this.config.fourdEmrApiKey;
        }
        if (this.config.fourdEmrClientId) {
            headers[this.config.fourdEmrClientIdHeader] = this.config.fourdEmrClientId;
        }
        if (this.config.fourdEmrClientSecret) {
            headers[this.config.fourdEmrClientSecretHeader] = this.config.fourdEmrClientSecret;
        }
        if (this.config.fourdEmrExtraAuthHeaderName && this.config.fourdEmrExtraAuthHeaderValue) {
            headers[this.config.fourdEmrExtraAuthHeaderName] = this.config.fourdEmrExtraAuthHeaderValue;
        }
        if (this.config.fourdEmrBearerToken) {
            headers.authorization = `Bearer ${this.config.fourdEmrBearerToken}`;
        }
        return headers;
    }
    async dynamicAuthHeaders() {
        if (this.config.fourdEmrBearerToken) {
            return {};
        }
        if (!this.config.fourdEmrOauth) {
            return {};
        }
        const accessToken = await this.getOAuthAccessToken();
        return {
            authorization: `Bearer ${accessToken}`
        };
    }
    async getOAuthAccessToken() {
        const now = Date.now();
        if (this.oauthTokenCache && this.oauthTokenCache.expiresAt > now + 5_000) {
            return this.oauthTokenCache.accessToken;
        }
        if (this.oauthTokenPromise) {
            return this.oauthTokenPromise;
        }
        this.oauthTokenPromise = this.fetchOAuthAccessToken().finally(() => {
            this.oauthTokenPromise = undefined;
        });
        return this.oauthTokenPromise;
    }
    async fetchOAuthAccessToken() {
        const oauth = this.config.fourdEmrOauth;
        if (!oauth) {
            throw new Error("4D EMR OAuth is not configured");
        }
        const payload = new URLSearchParams({
            grant_type: "client_credentials",
            client_id: oauth.clientId,
            client_secret: oauth.clientSecret
        });
        if (oauth.scope) {
            payload.set("scope", oauth.scope);
        }
        if (oauth.audience) {
            payload.set("audience", oauth.audience);
        }
        const response = await axios.post(oauth.tokenUrl, payload.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            timeout: 15_000
        });
        const accessToken = asString(getByPath(response.data, "access_token"));
        if (!accessToken) {
            throw new Error("OAuth token response did not include access_token");
        }
        const rawExpiresIn = getByPath(response.data, "expires_in");
        const expiresInSeconds = typeof rawExpiresIn === "number"
            ? rawExpiresIn
            : typeof rawExpiresIn === "string"
                ? Number(rawExpiresIn)
                : 3600;
        const safeExpiresIn = Number.isFinite(expiresInSeconds) ? Math.max(60, expiresInSeconds) : 3600;
        const expiresAt = Date.now() + (safeExpiresIn - 30) * 1000;
        this.oauthTokenCache = {
            accessToken,
            expiresAt
        };
        this.logger.debug({
            expiresInSeconds: safeExpiresIn
        }, "Fetched 4D EMR OAuth access token");
        return accessToken;
    }
    mapPatientSummary(entry) {
        const id = asString(getByPath(entry, this.config.fourdMappings.patientIdPath));
        const fullNameFromPath = this.config.fourdMappings.patientNamePath.length > 0
            ? asString(getByPath(entry, this.config.fourdMappings.patientNamePath))
            : undefined;
        const firstName = asString(getByPath(entry, this.config.fourdMappings.patientFirstNamePath));
        const lastName = asString(getByPath(entry, this.config.fourdMappings.patientLastNamePath));
        const joinedName = [firstName, lastName].filter((part) => Boolean(part)).join(" ");
        const fullName = fullNameFromPath ?? (joinedName.length > 0 ? joinedName : undefined);
        if (!id || !fullName) {
            this.logger.warn({
                patientIdPath: this.config.fourdMappings.patientIdPath,
                patientNamePath: this.config.fourdMappings.patientNamePath,
                received: entry
            }, "Skipping patient result with missing required id/name fields");
            return undefined;
        }
        return {
            id,
            fullName,
            mrn: asString(getByPath(entry, this.config.fourdMappings.patientMrnPath)),
            dateOfBirth: asString(getByPath(entry, this.config.fourdMappings.patientDobPath)),
            chartNumber: asString(getByPath(entry, this.config.fourdMappings.patientChartPath)),
            raw: entry
        };
    }
    lookupPhoneCandidates(phoneNumber) {
        const values = new Set();
        values.add(phoneNumber);
        const digitsOnly = phoneNumber.replace(/[^\d]/g, "");
        if (digitsOnly.length > 0) {
            values.add(digitsOnly);
        }
        if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
            values.add(digitsOnly.slice(1));
        }
        if (digitsOnly.length > 10) {
            values.add(digitsOnly.slice(-10));
        }
        return [...values];
    }
}
