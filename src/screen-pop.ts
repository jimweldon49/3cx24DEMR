import type { AppConfig } from "./config.js";

export function buildUrlFromTemplate(
  config: AppConfig,
  template: string | undefined,
  values: Record<string, string | undefined>
): string | undefined {
  if (!template) {
    return undefined;
  }

  let url = template;
  for (const [key, rawValue] of Object.entries(values)) {
    url = url.replaceAll(`{${key}}`, encodeURIComponent(rawValue ?? ""));
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return `${config.fourdEmrAppBaseUrl}${url}`;
}

export function screenPopUrl(config: AppConfig, patientId: string): string | undefined {
  return buildUrlFromTemplate(config, config.fourdMappings.screenPopPathTemplate, {
    patientId
  });
}

export function searchUrl(config: AppConfig, phone: string): string | undefined {
  return buildUrlFromTemplate(config, config.fourdMappings.patientSearchPathTemplate, {
    phone
  });
}

export function newPatientUrl(config: AppConfig, phone: string): string | undefined {
  return buildUrlFromTemplate(config, config.fourdMappings.newPatientPathTemplate, {
    phone
  });
}

export function appHomeUrl(config: AppConfig): string {
  return `${config.fourdEmrAppBaseUrl}/#`;
}
