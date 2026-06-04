import axios, { type AxiosInstance } from "axios";
import type { Logger } from "pino";
import type { AppConfig } from "../config.js";
import type { CallSession, PatientSummary } from "../types.js";
import { asString, getByPath } from "../utils.js";

export class FourdEmrClient {
  private readonly http: AxiosInstance;
  private readonly config: AppConfig;
  private readonly logger: Logger;

  constructor(config: AppConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.http = axios.create({
      baseURL: config.fourdEmrBaseUrl,
      timeout: 15_000,
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders()
      }
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

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.fourdEmrApiKey) {
      headers["x-api-key"] = this.config.fourdEmrApiKey;
    }
    if (this.config.fourdEmrBearerToken) {
      headers.authorization = `Bearer ${this.config.fourdEmrBearerToken}`;
    }
    return headers;
  }
}
