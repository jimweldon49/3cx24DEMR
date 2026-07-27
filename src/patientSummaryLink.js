import crypto from "node:crypto";

// Signs a short-lived (pid, exp) pair so the patient-summary page can be
// safely opened by a bare browser GET (3CX navigates to it directly -- no
// X-Api-Key header available) without exposing patient records via a
// guessable ?patientId=NNN URL. Falls back to an empty secret only when no
// CRM_TEMPLATE_API_KEY is configured (local/dev use), matching the same
// "no key configured -- dev mode" convention used for the CRM routes' auth.
function sign(config, patientId, exp) {
    const secret = config.crmTemplateApiKey ?? "";
    return crypto.createHmac("sha256", secret).update(`${patientId}:${exp}`).digest("hex");
}

export function createPatientSummaryUrl(config, requestOrigin, patientId) {
    const exp = Math.floor((Date.now() + config.patientSummaryLinkTtlMs) / 1000);
    const sig = sign(config, patientId, exp);
    const params = new URLSearchParams({ pid: String(patientId), exp: String(exp), sig });
    return `${requestOrigin}/crm/patient-summary?${params.toString()}`;
}

export function verifyPatientSummaryToken(config, patientId, exp, sig) {
    const expNum = Number(exp);
    if (!Number.isFinite(expNum) || !patientId || !sig) {
        return false;
    }
    if (Math.floor(Date.now() / 1000) > expNum) {
        return false;
    }
    const expected = sign(config, patientId, expNum);
    const provided = String(sig);
    if (expected.length !== provided.length) {
        return false;
    }
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}
