import axios, { AxiosHeaders, type AxiosInstance } from "axios";
import type { Logger } from "pino";
import type { AppConfig } from "../config.js";
import type { CallSession, PatientSummary } from "../types.js";
import { asString, getByPath } from "../utils.js";

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

  async findPatientByPhone(phoneNumber: string): Promise<PatientSummary | undefined> {
    const endpoint = this.config.fourdMappings.patientLookupPath;
    const queryParam = this.config.fourdMappings.patientLookupPhoneParam;
    const response = await this.http.get(endpoint, {
      params: {
        [queryParam]: phoneNumber
      }
    });

    const results = getByPath(response.data, this.config.fourdMappings.patientLookupResultPath);
    const list = Array.isArray(results) ? results : results != null ? [results] : [];
    if (list.length === 0) {
      return undefined;
    }

    const first = list[0];
    const id = asString(getByPath(first, this.config.fourdMappings.patientIdPath));
    const fullName = asString(getByPath(first, this.config.fourdMappings.patientNamePath));
    if (!id || !fullName) {
      this.logger.warn(
        {
          patientIdPath: this.config.fourdMappings.patientIdPath,
          patientNamePath: this.config.fourdMappings.patientNamePath,
          received: first
        },
        "Patient lookup returned a record missing required id/name fields"
      );
      return undefined;
    }

    return {
      id,
      fullName,
      mrn: asString(getByPath(first, this.config.fourdMappings.patientMrnPath)),
      dateOfBirth: asString(getByPath(first, this.config.fourdMappings.patientDobPath)),
      chartNumber: asString(getByPath(first, this.config.fourdMappings.patientChartPath)),
      raw: first
    };
  }

  async appendTranscriptToPatientChart(session: CallSession, transcript: string): Promise<void> {
    if (!session.patient?.id) {
      throw new Error("Cannot append transcript because call session has no patient");
    }

    const endpoint = this.config.fourdMappings.noteCreatePathTemplate.replace(
      "{patientId}",
      encodeURIComponent(session.patient.id)
    );

    const payload = {
      noteType: "phone_call_transcript",
      title: `3CX Call ${session.callId}`,
      text: transcript,
      metadata: {
        source: "3cx-v20",
        callId: session.callId,
        fromNumber: session.fromNumber,
        toNumber: session.toNumber,
        direction: session.direction,
        agentExtension: session.agentExtension,
        startedAt: session.startedAt,
        syncedAt: new Date().toISOString()
      }
    };

    await this.http.post(endpoint, payload);
  }

  private staticAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.fourdEmrApiKey) {
      headers["x-api-key"] = this.config.fourdEmrApiKey;
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
}
