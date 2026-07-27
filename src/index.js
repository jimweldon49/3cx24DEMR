import express from "express";
import { pinoHttp } from "pino-http";
import { getConfig } from "./config.js";
import { logger } from "./logger.js";
import { FourdEmrClient } from "./clients/fourd-emr-client.js";
import { CallSessionStore } from "./services/call-session-store.js";
import { EventIdStore } from "./services/event-id-store.js";
import { LeadIdStore } from "./leadIdStore.js";
import { createWebhookRouter } from "./routes/webhooks.js";
import { createCrmRouter } from "./routes/crm.js";

const config = getConfig();
const app = express();

app.use(express.json({
    // /crm/report-call carries 3CX's own transcript/summary tokens spliced into
    // the JSON body without escaping control characters (real transcripts contain
    // raw newlines) -- strict body-parser throws on that before the route ever
    // runs. That route reads and sanitizes its own body instead (see crm.js).
    type: (req) => !req.originalUrl.startsWith("/crm/report-call"),
    verify: (req, _res, buffer) => {
        req.rawBody = buffer.toString("utf8");
    }
}));
app.use(pinoHttp({ logger }));

const leadIdStore = new LeadIdStore(config, logger);
const fourdEmrClient = new FourdEmrClient(config, logger, leadIdStore);
const callSessions = new CallSessionStore(config.callSessionTtlMs);
const processedEvents = new EventIdStore(config.callSessionTtlMs);

app.get("/health", (_req, res) => {
    res.status(200).json({
        status: "ok",
        service: "3cx-4d-emr-integration",
        timestamp: new Date().toISOString()
    });
});

const deps = { config, logger, fourdEmrClient, callSessions, processedEvents };

app.use("/webhooks", createWebhookRouter(deps));
app.use("/crm", createCrmRouter(deps));

app.use((error, _req, res, _next) => {
    logger.error({ err: error }, "Unhandled application error");
    res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => {
    logger.info({
        port: config.port,
        tenantUrl: config.threeCxTenantUrl,
        fourdBaseUrl: config.fourdEmrBaseUrl
    }, "3CX/4D EMR integration service started");
});
