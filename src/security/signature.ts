import crypto from "node:crypto";

function normalizeSignature(input: string): string {
  return input.replace(/^sha256=/i, "").trim().toLowerCase();
}

export function isSignatureValid(options: {
  secret: string;
  rawBody: string;
  providedSignature: string;
}): boolean {
  const expected = crypto
    .createHmac("sha256", options.secret)
    .update(options.rawBody, "utf8")
    .digest("hex")
    .toLowerCase();
  const provided = normalizeSignature(options.providedSignature);

  if (provided.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
