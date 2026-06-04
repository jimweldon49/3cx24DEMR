import express from "express";
import { pinoHttp } from "pino-http";
import { getConfig } from "./config.js";
import { logger } from "./logger.js";
import { FourdEmrClient } from "./clients/fourd-emr-client.js";
import { CallSessionStore } from "./services/call-session-store.js";
import { EventIdStore } from "./services/event-id-store.js";
import { createWebhookRouter } from "./routes/webhooks.js";

const config = getConfig();
const app = express();

app.use(
  express.json({
    verify: (req, _res, buffer) => {
      (req as express.Request & { rawBody?: string }).rawBody = buffer.toString("utf8");
    }
  })
);
app.use(pinoHttp({ logger }));

const fourdEmrClient = new FourdEmrClient(config, logger);
const callSessions = new CallSessionStore(config.callSessionTtlMs);
const processedEvents = new EventIdStore(config.callSessionTtlMs);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "3cx-4d-emr-integration",
    timestamp: new Date().toISOString()
  });
});

app.use(
  "/webhooks",
  createWebhookRouter({
    config,
    logger,
    fourdEmrClient,
    callSessions,
    processedEvents
  })
);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: error }, "Unhandled application error");
  res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      tenantUrl: config.threeCxTenantUrl,
      fourdBaseUrl: config.fourdEmrBaseUrl
    },
    "3CX/4D EMR integration service started"
  );
});
