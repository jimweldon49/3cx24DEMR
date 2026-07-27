export function normalizePhoneNumber(rawNumber) {
    const cleaned = rawNumber.replace(/[^\d+]/g, "");
    if (cleaned.startsWith("+")) {
        return cleaned;
    }
    return cleaned.startsWith("1") ? `+${cleaned}` : `+1${cleaned}`;
}
export function getByPath(input, path) {
    return path.split(".").reduce((acc, segment) => {
        if (acc == null || typeof acc !== "object") {
            return undefined;
        }
        if (Array.isArray(acc)) {
            const index = Number(segment);
            return Number.isInteger(index) ? acc[index] : undefined;
        }
        return acc[segment];
    }, input);
}
export function asString(value) {
    if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return undefined;
}
export function asPositiveInt(value) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return undefined;
}
