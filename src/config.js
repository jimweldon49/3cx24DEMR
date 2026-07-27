import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    LOG_LEVEL: z.string().default("info"),
    PUBLIC_BASE_URL: z.string().url().optional(),
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
    FOURD_EMR_PATIENT_LOOKUP_NEED_TOTAL_COUNT: z.coerce.boolean().default(true),
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
    FOURD_EMR_NOTE_CREATE_PATH_TEMPLATE: z.string().default("/api/public/chartNotes"),
    FOURD_EMR_TELEPHONE_NOTE_TYPE_ID: z.coerce.number().int().positive().default(2),
    FOURD_EMR_INCLUDE_PATIENT_ID_IN_NOTE: z.coerce.boolean().default(false),
    FOURD_EMR_DEFAULT_APPOINTMENT_ID: z.coerce.number().int().positive().optional(),
    FOURD_EMR_REQUIRE_APPOINTMENT_ID: z.coerce.boolean().default(false),
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
    REDACT_SSN_IN_TRANSCRIPTS: z.coerce.boolean().default(true),
    CALL_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(240),
    PATIENT_SUMMARY_LINK_TTL_MINUTES: z.coerce.number().int().min(1).max(180).default(30)
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

    cachedConfig = {
        port: parsed.PORT,
        logLevel: parsed.LOG_LEVEL,
        publicBaseUrl: trimTrailingSlash(publicBaseUrl),
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
            noteCreatePathTemplate: parsed.FOURD_EMR_NOTE_CREATE_PATH_TEMPLATE,
            telephoneNoteTypeId: parsed.FOURD_EMR_TELEPHONE_NOTE_TYPE_ID,
            includePatientIdInNote: parsed.FOURD_EMR_INCLUDE_PATIENT_ID_IN_NOTE,
            defaultAppointmentId: parsed.FOURD_EMR_DEFAULT_APPOINTMENT_ID,
            requireAppointmentId: parsed.FOURD_EMR_REQUIRE_APPOINTMENT_ID,
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
        patientSummaryLinkTtlMs: parsed.PATIENT_SUMMARY_LINK_TTL_MINUTES * 60 * 1000
    };
    return cachedConfig;
}
