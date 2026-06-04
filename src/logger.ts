import pino from "pino";
import { getConfig } from "./config.js";

const config = getConfig();

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.x-api-key",
      "*.authorization",
      "*.apiKey",
      "*.token",
      "*.secret"
    ],
    censor: "[REDACTED]"
  }
});
