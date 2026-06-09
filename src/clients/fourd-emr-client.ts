import axios, { AxiosHeaders, type AxiosInstance } from "axios";
import type { Logger } from "pino";
import type { AppConfig } from "../config.js";
import type { CallSession, PatientSummary } from "../types.js";
import { asPositiveInt, asString, getByPath } from "../utils.js";

type OAuthTokenCache = {
  accessToken: string;
  expiresAt: number;
};

export class FourdEmrClient {
  private readonly http: AxiosInstance;
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private oauthTokenCache?: OAuthTokenCache;
  private oauthTokenPromise?: Promise<string>;

  constructor(config: AppConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
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

  async findPatientsByPhone(phoneNumber: string): Promise<PatientSummary[]> {
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

  async appendTranscriptToPatientChart(session: CallSession, transcript: string): Promise<void> {
    const endpoint = this.config.fourdMappings.noteCreatePathTemplate;
    const appointmentId = session.appointmentId ?? this.config.fourdMappings.defaultAppointmentId;
    if (this.config.fourdMappings.requireAppointmentId && !appointmentId) {
      throw new Error("Cannot append transcript because appointmentId is required but missing");
    }

    const callSummaryLines = [
      "Source: 3CX v20",
      `Call ID: ${session.callId}`,
      `Direction: ${session.direction}`,
      `From: ${session.fromNumber}`,
      session.toNumber ? `To: ${session.toNumber}` : undefined,
      session.agentExtension ? `Agent Extension: ${session.agentExtension}` : undefined,
      `Call Started At: ${session.startedAt}`
    ].filter((line): line is string => Boolean(line));
    const composedNoteText = `${callSummaryLines.join("\n")}\n\nTranscript:\n${transcript}`;
    const payload = {
      SignedOn: new Date().toISOString(),
      ChartNoteTypeID: this.config.fourdMappings.telephoneNoteTypeId,
      NoteText: composedNoteText,
      ...(appointmentId
        ? {
            AppointmentId: appointmentId
          }
        : {}),
      ...(this.config.fourdMappings.includePatientIdInNote && session.patient?.id
        ? {
            PatientId: asPositiveInt(session.patient.id) ?? session.patient.id
          }
        : {})
    };

    await this.http.post(endpoint, payload);
  }

  private staticAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
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

  private async dynamicAuthHeaders(): Promise<Record<string, string>> {
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

  private async getOAuthAccessToken(): Promise<string> {
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

  private async fetchOAuthAccessToken(): Promise<string> {
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
    const expiresInSeconds =
      typeof rawExpiresIn === "number"
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

    this.logger.debug(
      {
        expiresInSeconds: safeExpiresIn
      },
      "Fetched 4D EMR OAuth access token"
    );

    return accessToken;
  }

  private mapPatientSummary(entry: unknown): PatientSummary | undefined {
    const id = asString(getByPath(entry, this.config.fourdMappings.patientIdPath));
    const fullNameFromPath =
      this.config.fourdMappings.patientNamePath.length > 0
        ? asString(getByPath(entry, this.config.fourdMappings.patientNamePath))
        : undefined;
    const firstName = asString(getByPath(entry, this.config.fourdMappings.patientFirstNamePath));
    const lastName = asString(getByPath(entry, this.config.fourdMappings.patientLastNamePath));
    const joinedName = [firstName, lastName].filter((part): part is string => Boolean(part)).join(" ");
    const fullName = fullNameFromPath ?? (joinedName.length > 0 ? joinedName : undefined);
    if (!id || !fullName) {
      this.logger.warn(
        {
          patientIdPath: this.config.fourdMappings.patientIdPath,
          patientNamePath: this.config.fourdMappings.patientNamePath,
          received: entry
        },
        "Skipping patient result with missing required id/name fields"
      );
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

  private lookupPhoneCandidates(phoneNumber: string): string[] {
    const values = new Set<string>();
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
