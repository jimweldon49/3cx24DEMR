import "dotenv/config";
import { z } from "zod";

// z.coerce.boolean() uses JS `Boolean(value)`, so the string "false" coerces
// to `true` (any non-empty string is truthy) -- a real footgun for env vars,
// which are always strings. This actually shipped MISSED_CALL_SMS_ENABLED=false
// as enabled in production on 2026-07-28. Use this for every boolean env var.
function booleanEnv(defaultValue) {
    return z.preprocess((value) => {
        if (typeof value === "string") {
            return value.trim().toLowerCase() === "true";
        }
        return value;
    }, z.boolean().default(defaultValue));
}

const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    LOG_LEVEL: z.string().default("info"),
    PUBLIC_BASE_URL: z.string().url().optional(),
    AZURE_STORAGE_CONNECTION_STRING: z.string().min(1).optional(),
    THREE_CX_TENANT_URL: z.string().url().optional(),
    THREE_CX_WEBHOOK_SECRET: z.string().min(1).optional(),
    CRM_TEMPLATE_API_KEY: z.string().min(1).optional(),
    FOURD_EMR_BASE_URL: z.string().url(),
    FOURD_EMR_APP_BASE_URL: z.string().url().optional(),
    FOURD_EMR_API_KEY: z.string().min(1).optional(),
    FOURD_EMR_CLIENT_ID: z.string().min(1).optional(),
    FOURD_EMR_CLIENT_SECRET: z.string().min(1).optional(),
    FOURD_EMR_CLIENT_ID_HEADER: z.string().default("x-client-id"),
    FOURD_EMR_CLIENT_SECRET_HEADER: z.string().default("x-client-secret"),
    FOURD_EMR_EXTRA_AUTH_HEADER_NAME: z.string().min(1).optional(),
    FOURD_EMR_EXTRA_AUTH_HEADER_VALUE: z.string().min(1).optional(),
    FOURD_EMR_BEARER_TOKEN: z.string().min(1).optional(),
    FOURD_EMR_OAUTH_TOKEN_URL: z.string().url().optional(),
    FOURD_EMR_OAUTH_CLIENT_ID: z.string().min(1).optional(),
    FOURD_EMR_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
    FOURD_EMR_OAUTH_SCOPE: z.string().min(1).optional(),
    FOURD_EMR_OAUTH_AUDIENCE: z.string().min(1).optional(),
    FOURD_EMR_PATIENT_LOOKUP_PATH: z.string().default("/api/public/patients"),
    FOURD_EMR_PATIENT_LOOKUP_PHONE_PARAM: z.string().default("phone"),
    FOURD_EMR_PATIENT_LOOKUP_RESULT_PATH: z.string().default("Items"),
    FOURD_EMR_PATIENT_LOOKUP_PAGE_COUNT: z.coerce.number().int().positive().default(20),
    FOURD_EMR_PATIENT_LOOKUP_PAGE_SKIP: z.coerce.number().int().min(0).default(0),
    FOURD_EMR_PATIENT_LOOKUP_NEED_TOTAL_COUNT: booleanEnv(true),
    FOURD_EMR_PATIENT_ID_PATH: z.string().default("PatientId"),
    FOURD_EMR_PATIENT_NAME_PATH: z.string().default(""),
    FOURD_EMR_PATIENT_FIRST_NAME_PATH: z.string().default("FirstName"),
    FOURD_EMR_PATIENT_LAST_NAME_PATH: z.string().default("LastName"),
    FOURD_EMR_PATIENT_MRN_PATH: z.string().default("AccountNumber"),
    FOURD_EMR_PATIENT_DOB_PATH: z.string().default("DOB"),
    FOURD_EMR_PATIENT_CHART_PATH: z.string().default("PatientId"),
    FOURD_EMR_SCREEN_POP_PATH_TEMPLATE: z
        .string()
        .default("https://app.4d-emr.com/#/patients/profile/details?ptId={patientId}"),
    FOURD_EMR_PATIENT_SEARCH_PATH_TEMPLATE: z.string().default(""),
    FOURD_EMR_NEW_PATIENT_PATH_TEMPLATE: z.string().default(""),
    FOURD_EMR_LEAD_CREATE_PATH: z.string().default("/api/public/leads"),
    FOURD_EMR_LEAD_NOTE_CREATE_PATH: z.string().default("/api/public/leads/notes"),
    FOURD_EMR_LEAD_REFERRING_SOURCE: z.string().default("3CX Inbound Call"),
    FOURD_EMR_APPOINTMENT_LOOKUP_PATH: z.string().default("/api/public/appointments"),
    FOURD_EMR_APPOINTMENT_LOOKUP_PATIENT_ID_PARAM: z.string().default("patientId"),
    SCREEN_POP_MULTI_MATCH_ACTION: z
        .enum(["pick_list", "open_first", "search"])
        .default("pick_list"),
    SCREEN_POP_NO_MATCH_ACTION: z
        .enum(["new_patient", "search", "none"])
        .default("new_patient"),
    REDACT_SSN_IN_TRANSCRIPTS: booleanEnv(true),
    CALL_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(240),
    PATIENT_SUMMARY_LINK_TTL_MINUTES: z.coerce.number().int().min(1).max(180).default(30),

    // Missed-call SMS: 3CX Call Control API (queue abandonment detection) + Voxtelesys (send)
    MISSED_CALL_SMS_ENABLED: booleanEnv(false),
    THREE_CX_CC_CLIENT_ID: z.string().min(1).optional(),
    THREE_CX_CC_CLIENT_SECRET: z.string().min(1).optional(),
    THREE_CX_QUEUE_DN: z.string().min(1).optional(),
    THREE_CX_QUEUE_AGENT_DNS: z.string().min(1).optional(),
    THREE_CX_ABANDON_DECISION_DELAY_MS: z.coerce.number().int().min(200).max(10000).default(2000),
    MISSED_CALL_SMS_COOLDOWN_MINUTES: z.coerce.number().int().min(0).max(1440).default(10),
    VOXTELESYS_SMS_API_URL: z.string().url().default("https://smsapi.voxtelesys.net/api/v1/sms"),
    VOXTELESYS_SMS_API_KEY: z.string().min(1).optional(),
    VOXTELESYS_SMS_FROM_NUMBER: z.string().min(1).optional(),
    MISSED_CALL_SMS_MESSAGE: z
        .string()
        .min(1)
        .default("Sorry that we missed your call, please feel free to reply back to this SMS and chat with us.")
});

let cachedConfig = null;

function trimTrailingSlash(url) {
    return url.endsWith("/") ? url.slice(0, -1) : url;
}

function cleanTemplate(template) {
    const normalized = template.trim();
    return normalized.length > 0 ? normalized : undefined;
}

export function getConfig() {
    if (cachedConfig) {
        return cachedConfig;
    }
    const parsed = envSchema.parse(process.env);

    const oauthValues = [
        parsed.FOURD_EMR_OAUTH_TOKEN_URL,
        parsed.FOURD_EMR_OAUTH_CLIENT_ID,
        parsed.FOURD_EMR_OAUTH_CLIENT_SECRET
    ];
    const oauthSetCount = oauthValues.filter((value) => Boolean(value)).length;
    if (oauthSetCount > 0 && oauthSetCount < oauthValues.length) {
        throw new Error("FOURD_EMR_OAUTH_TOKEN_URL, FOURD_EMR_OAUTH_CLIENT_ID, and FOURD_EMR_OAUTH_CLIENT_SECRET must be set together");
    }

    const extraAuthHeaderValues = [
        parsed.FOURD_EMR_EXTRA_AUTH_HEADER_NAME,
        parsed.FOURD_EMR_EXTRA_AUTH_HEADER_VALUE
    ];
    const extraAuthSetCount = extraAuthHeaderValues.filter((value) => Boolean(value)).length;
    if (extraAuthSetCount > 0 && extraAuthSetCount < extraAuthHeaderValues.length) {
        throw new Error("FOURD_EMR_EXTRA_AUTH_HEADER_NAME and FOURD_EMR_EXTRA_AUTH_HEADER_VALUE must be set together");
    }

    const publicBaseUrl = parsed.PUBLIC_BASE_URL ?? `http://localhost:${parsed.PORT}`;

    if (parsed.MISSED_CALL_SMS_ENABLED) {
        const required = {
            THREE_CX_CC_CLIENT_ID: parsed.THREE_CX_CC_CLIENT_ID,
            THREE_CX_CC_CLIENT_SECRET: parsed.THREE_CX_CC_CLIENT_SECRET,
            THREE_CX_QUEUE_DN: parsed.THREE_CX_QUEUE_DN,
            THREE_CX_QUEUE_AGENT_DNS: parsed.THREE_CX_QUEUE_AGENT_DNS,
            THREE_CX_TENANT_URL: parsed.THREE_CX_TENANT_URL,
            VOXTELESYS_SMS_API_KEY: parsed.VOXTELESYS_SMS_API_KEY,
            VOXTELESYS_SMS_FROM_NUMBER: parsed.VOXTELESYS_SMS_FROM_NUMBER
        };
        const missing = Object.entries(required)
            .filter(([, value]) => !value)
            .map(([name]) => name);
        if (missing.length > 0) {
            throw new Error(`MISSED_CALL_SMS_ENABLED is true but missing: ${missing.join(", ")}`);
        }
    }

    cachedConfig = {
        port: parsed.PORT,
        logLevel: parsed.LOG_LEVEL,
        publicBaseUrl: trimTrailingSlash(publicBaseUrl),
        azureStorageConnectionString: parsed.AZURE_STORAGE_CONNECTION_STRING,
        threeCxTenantUrl: parsed.THREE_CX_TENANT_URL,
        threeCxWebhookSecret: parsed.THREE_CX_WEBHOOK_SECRET,
        crmTemplateApiKey: parsed.CRM_TEMPLATE_API_KEY,
        fourdEmrBaseUrl: trimTrailingSlash(parsed.FOURD_EMR_BASE_URL),
        fourdEmrAppBaseUrl: trimTrailingSlash(parsed.FOURD_EMR_APP_BASE_URL ?? parsed.FOURD_EMR_BASE_URL),
        fourdEmrApiKey: parsed.FOURD_EMR_API_KEY,
        fourdEmrClientId: parsed.FOURD_EMR_CLIENT_ID,
        fourdEmrClientSecret: parsed.FOURD_EMR_CLIENT_SECRET,
        fourdEmrClientIdHeader: parsed.FOURD_EMR_CLIENT_ID_HEADER,
        fourdEmrClientSecretHeader: parsed.FOURD_EMR_CLIENT_SECRET_HEADER,
        fourdEmrExtraAuthHeaderName: parsed.FOURD_EMR_EXTRA_AUTH_HEADER_NAME,
        fourdEmrExtraAuthHeaderValue: parsed.FOURD_EMR_EXTRA_AUTH_HEADER_VALUE,
        fourdEmrBearerToken: parsed.FOURD_EMR_BEARER_TOKEN,
        fourdEmrOauth: parsed.FOURD_EMR_OAUTH_TOKEN_URL &&
            parsed.FOURD_EMR_OAUTH_CLIENT_ID &&
            parsed.FOURD_EMR_OAUTH_CLIENT_SECRET
            ? {
                tokenUrl: parsed.FOURD_EMR_OAUTH_TOKEN_URL,
                clientId: parsed.FOURD_EMR_OAUTH_CLIENT_ID,
                clientSecret: parsed.FOURD_EMR_OAUTH_CLIENT_SECRET,
                scope: parsed.FOURD_EMR_OAUTH_SCOPE,
                audience: parsed.FOURD_EMR_OAUTH_AUDIENCE
            }
            : undefined,
        fourdMappings: {
            patientLookupPath: parsed.FOURD_EMR_PATIENT_LOOKUP_PATH,
            patientLookupPhoneParam: parsed.FOURD_EMR_PATIENT_LOOKUP_PHONE_PARAM,
            patientLookupResultPath: parsed.FOURD_EMR_PATIENT_LOOKUP_RESULT_PATH,
            patientLookupPageCount: parsed.FOURD_EMR_PATIENT_LOOKUP_PAGE_COUNT,
            patientLookupPageSkip: parsed.FOURD_EMR_PATIENT_LOOKUP_PAGE_SKIP,
            patientLookupNeedTotalCount: parsed.FOURD_EMR_PATIENT_LOOKUP_NEED_TOTAL_COUNT,
            patientIdPath: parsed.FOURD_EMR_PATIENT_ID_PATH,
            patientNamePath: parsed.FOURD_EMR_PATIENT_NAME_PATH,
            patientFirstNamePath: parsed.FOURD_EMR_PATIENT_FIRST_NAME_PATH,
            patientLastNamePath: parsed.FOURD_EMR_PATIENT_LAST_NAME_PATH,
            patientMrnPath: parsed.FOURD_EMR_PATIENT_MRN_PATH,
            patientDobPath: parsed.FOURD_EMR_PATIENT_DOB_PATH,
            patientChartPath: parsed.FOURD_EMR_PATIENT_CHART_PATH,
            screenPopPathTemplate: cleanTemplate(parsed.FOURD_EMR_SCREEN_POP_PATH_TEMPLATE),
            patientSearchPathTemplate: cleanTemplate(parsed.FOURD_EMR_PATIENT_SEARCH_PATH_TEMPLATE),
            newPatientPathTemplate: cleanTemplate(parsed.FOURD_EMR_NEW_PATIENT_PATH_TEMPLATE),
            leadCreatePath: parsed.FOURD_EMR_LEAD_CREATE_PATH,
            leadNoteCreatePath: parsed.FOURD_EMR_LEAD_NOTE_CREATE_PATH,
            leadReferringSource: parsed.FOURD_EMR_LEAD_REFERRING_SOURCE,
            appointmentLookupPath: parsed.FOURD_EMR_APPOINTMENT_LOOKUP_PATH,
            appointmentLookupPatientIdParam: parsed.FOURD_EMR_APPOINTMENT_LOOKUP_PATIENT_ID_PARAM
        },
        screenPopBehavior: {
            multiMatchAction: parsed.SCREEN_POP_MULTI_MATCH_ACTION,
            noMatchAction: parsed.SCREEN_POP_NO_MATCH_ACTION
        },
        transcriptRedaction: {
            redactSsn: parsed.REDACT_SSN_IN_TRANSCRIPTS
        },
        callSessionTtlMs: parsed.CALL_SESSION_TTL_MINUTES * 60 * 1000,
        patientSummaryLinkTtlMs: parsed.PATIENT_SUMMARY_LINK_TTL_MINUTES * 60 * 1000,
        missedCallSms: {
            enabled: parsed.MISSED_CALL_SMS_ENABLED,
            threeCxApiBaseUrl: parsed.THREE_CX_TENANT_URL ? trimTrailingSlash(parsed.THREE_CX_TENANT_URL) : undefined,
            ccClientId: parsed.THREE_CX_CC_CLIENT_ID,
            ccClientSecret: parsed.THREE_CX_CC_CLIENT_SECRET,
            queueDn: parsed.THREE_CX_QUEUE_DN,
            queueAgentDns: parsed.THREE_CX_QUEUE_AGENT_DNS
                ? parsed.THREE_CX_QUEUE_AGENT_DNS.split(",").map((dn) => dn.trim()).filter(Boolean)
                : [],
            abandonDecisionDelayMs: parsed.THREE_CX_ABANDON_DECISION_DELAY_MS,
            cooldownMs: parsed.MISSED_CALL_SMS_COOLDOWN_MINUTES * 60 * 1000,
            voxtelesysSmsApiUrl: parsed.VOXTELESYS_SMS_API_URL,
            voxtelesysSmsApiKey: parsed.VOXTELESYS_SMS_API_KEY,
            voxtelesysSmsFromNumber: parsed.VOXTELESYS_SMS_FROM_NUMBER,
            message: parsed.MISSED_CALL_SMS_MESSAGE
        }
    };
    return cachedConfig;
}
