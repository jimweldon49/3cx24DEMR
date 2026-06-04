export function normalizePhoneNumber(rawNumber: string): string {
  const cleaned = rawNumber.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  return cleaned.startsWith("1") ? `+${cleaned}` : `+1${cleaned}`;
}

export function getByPath(input: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, segment) => {
    if (acc == null || typeof acc !== "object") {
      return undefined;
    }

    if (Array.isArray(acc)) {
      const index = Number(segment);
      return Number.isInteger(index) ? acc[index] : undefined;
    }

    return (acc as Record<string, unknown>)[segment];
  }, input);
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}
