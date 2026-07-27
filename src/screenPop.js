export function buildUrlFromTemplate(config, template, values) {
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

export function screenPopUrl(config, patientId) {
    return buildUrlFromTemplate(config, config.fourdMappings.screenPopPathTemplate, { patientId });
}

export function searchUrl(config, phone) {
    return buildUrlFromTemplate(config, config.fourdMappings.patientSearchPathTemplate, { phone });
}

export function newPatientUrl(config, phone) {
    return buildUrlFromTemplate(config, config.fourdMappings.newPatientPathTemplate, { phone });
}

export function appHomeUrl(config) {
    return `${config.fourdEmrAppBaseUrl}/#`;
}

export function summarizePatient(patient) {
    return {
        id: patient.id,
        fullName: patient.fullName,
        mrn: patient.mrn,
        dateOfBirth: patient.dateOfBirth,
        chartNumber: patient.chartNumber
    };
}

export function resolveScreenPopAction(input) {
    const { config, patientCount, selectedPatient, fromNumber } = input;
    if (patientCount === 1 && selectedPatient) {
        const url = screenPopUrl(config, selectedPatient.id);
        return url ? { action: "open_patient", url } : { action: "none" };
    }
    if (patientCount > 1) {
        if (config.screenPopBehavior.multiMatchAction === "open_first" && selectedPatient) {
            const url = screenPopUrl(config, selectedPatient.id);
            return url ? { action: "open_patient", url } : { action: "none" };
        }
        if (config.screenPopBehavior.multiMatchAction === "search") {
            const url = searchUrl(config, fromNumber);
            return { action: "search", url: url ?? appHomeUrl(config) };
        }
        const url = searchUrl(config, fromNumber);
        return { action: "pick_list", url };
    }
    if (config.screenPopBehavior.noMatchAction === "new_patient") {
        const url = newPatientUrl(config, fromNumber);
        return { action: "new_patient", url: url ?? appHomeUrl(config) };
    }
    if (config.screenPopBehavior.noMatchAction === "search") {
        const url = searchUrl(config, fromNumber);
        return { action: "search", url: url ?? appHomeUrl(config) };
    }
    return { action: "none" };
}
