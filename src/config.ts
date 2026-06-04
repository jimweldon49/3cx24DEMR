import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.string().default("info"),
  PUBLIC_BASE_URL: z.string().url().optional(),
  THREE_CX_TENANT_URL: z.string().url().optional(),
  THREE_CX_WEBHOOK_SECRET: z.string().min(1).optional(),
  FOURD_EMR_BASE_URL: z.string().url(),
  FOURD_EMR_API_KEY: z.string().min(1).optional(),
  FOURD_EMR_BEARER_TOKEN: z.string().min(1).optional(),
  FOURD_EMR_PATIENT_LOOKUP_PATH: z.string().default("/api/patients/search"),
  FOURD_EMR_PATIENT_LOOKUP_PHONE_PARAM: z.string().default("phone"),
  FOURD_EMR_PATIENT_LOOKUP_RESULT_PATH: z.string().default("data.patients"),
  FOURD_EMR_PATIENT_ID_PATH: z.string().default("id"),
  FOURD_EMR_PATIENT_NAME_PATH: z.string().default("fullName"),
  FOURD_EMR_PATIENT_MRN_PATH: z.string().default("mrn"),
  FOURD_EMR_PATIENT_DOB_PATH: z.string().default("dateOfBirth"),
  FOURD_EMR_PATIENT_CHART_PATH: z.string().default("chartNumber"),
  FOURD_EMR_SCREEN_POP_PATH_TEMPLATE: z.string().default("/patients/{patientId}"),
  FOURD_EMR_NOTE_CREATE_PATH_TEMPLATE: z.string().default("/api/patients/{patientId}/notes"),
  CALL_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(240)
});

export type AppConfig = {
  port: number;
  logLevel: string;
  publicBaseUrl: string;
  threeCxTenantUrl?: string;
  threeCxWebhookSecret?: string;
  fourdEmrBaseUrl: string;
  fourdEmrApiKey?: string;
  fourdEmrBearerToken?: string;
  fourdMappings: {
    patientLookupPath: string;
    patientLookupPhoneParam: string;
    patientLookupResultPath: string;
    patientIdPath: string;
    patientNamePath: string;
    patientMrnPath: string;
    patientDobPath: string;
    patientChartPath: string;
    screenPopPathTemplate: string;
    noteCreatePathTemplate: string;
  };
  callSessionTtlMs: number;
};

let cachedConfig: AppConfig | null = null;

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function getConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const parsed = envSchema.parse(process.env);
  const publicBaseUrl = parsed.PUBLIC_BASE_URL ?? `http://localhost:${parsed.PORT}`;

  cachedConfig = {
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    publicBaseUrl: trimTrailingSlash(publicBaseUrl),
    threeCxTenantUrl: parsed.THREE_CX_TENANT_URL,
    threeCxWebhookSecret: parsed.THREE_CX_WEBHOOK_SECRET,
    fourdEmrBaseUrl: trimTrailingSlash(parsed.FOURD_EMR_BASE_URL),
    fourdEmrApiKey: parsed.FOURD_EMR_API_KEY,
    fourdEmrBearerToken: parsed.FOURD_EMR_BEARER_TOKEN,
    fourdMappings: {
      patientLookupPath: parsed.FOURD_EMR_PATIENT_LOOKUP_PATH,
      patientLookupPhoneParam: parsed.FOURD_EMR_PATIENT_LOOKUP_PHONE_PARAM,
      patientLookupResultPath: parsed.FOURD_EMR_PATIENT_LOOKUP_RESULT_PATH,
      patientIdPath: parsed.FOURD_EMR_PATIENT_ID_PATH,
      patientNamePath: parsed.FOURD_EMR_PATIENT_NAME_PATH,
      patientMrnPath: parsed.FOURD_EMR_PATIENT_MRN_PATH,
      patientDobPath: parsed.FOURD_EMR_PATIENT_DOB_PATH,
      patientChartPath: parsed.FOURD_EMR_PATIENT_CHART_PATH,
      screenPopPathTemplate: parsed.FOURD_EMR_SCREEN_POP_PATH_TEMPLATE,
      noteCreatePathTemplate: parsed.FOURD_EMR_NOTE_CREATE_PATH_TEMPLATE
    },
    callSessionTtlMs: parsed.CALL_SESSION_TTL_MINUTES * 60 * 1000
  };

  return cachedConfig;
}
