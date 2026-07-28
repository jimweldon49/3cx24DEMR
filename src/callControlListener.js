import axios from "axios";
import WebSocket from "ws";
import { sendSms } from "./voxtelesysSms.js";

/**
 * Detects abandoned/missed calls in a 3CX queue and texts the caller.
 *
 * Native 3CX queues hand the call off to a subsystem the Call Flow Designer
 * can't see into -- there is no "on hangup while queued" event reachable
 * from CFD (confirmed 2026-07-28 across multiple 3CX community threads, and
 * empirically: a CFD flow only knows about a call while it's flowing
 * through that same script). The only way to detect this is the Call
 * Control API (the xAPI/WebSocket variant, which supports secure remote
 * access -- not the older .NET version, which is localhost-only).
 *
 * Detection rule (derived empirically 2026-07-28 by watching real answered
 * vs. abandoned calls side by side against a live queue): when a call rings
 * into the queue, it simultaneously rings every agent extension too
 * (status "Ringing" on each). If the call is answered, exactly one agent
 * extension transitions to status "Connected" while every other ringing
 * leg -- and the queue's own leg -- gets dropped at the same moment. If the
 * call is abandoned, every leg (queue + all agents) gets dropped while
 * still "Ringing" -- no extension ever reaches "Connected". So: track
 * whether any monitored agent DN reached "Connected" for a given callid;
 * once the queue's own participant for that callid is removed, wait a
 * short debounce window (agent "Connected" events can arrive slightly
 * after the queue-removal event over the WebSocket, though the underlying
 * state change happens first) and then check the flag.
 */
export class CallControlListener {
    config;
    logger;
    calls = new Map(); // callid -> { queueParticipantId, callerNumber, answered }
    recentlyTexted = new Map(); // phone -> timestamp of last SMS sent
    accessToken;
    tokenExpiresAt = 0;
    ws;
    reconnectDelayMs = 5000;

    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }

    start() {
        if (!this.config.missedCallSms.enabled) {
            this.logger.info("Missed-call SMS feature disabled (MISSED_CALL_SMS_ENABLED=false)");
            return;
        }
        this.connect().catch((err) => this.logger.error({ err }, "Call Control listener failed to start"));
    }

    async getToken() {
        if (this.accessToken && Date.now() < this.tokenExpiresAt) {
            return this.accessToken;
        }
        const { threeCxApiBaseUrl, ccClientId, ccClientSecret } = this.config.missedCallSms;
        const response = await axios.post(
            `${threeCxApiBaseUrl}/connect/token`,
            new URLSearchParams({
                grant_type: "client_credentials",
                client_id: ccClientId,
                client_secret: ccClientSecret
            }).toString(),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15_000 }
        );
        this.accessToken = response.data.access_token;
        this.tokenExpiresAt = Date.now() + (response.data.expires_in - 60) * 1000;
        return this.accessToken;
    }

    async connect() {
        const token = await this.getToken();
        const baseUrl = new URL(this.config.missedCallSms.threeCxApiBaseUrl);
        const wsScheme = baseUrl.protocol === "https:" ? "wss:" : "ws:";
        this.ws = new WebSocket(`${wsScheme}//${baseUrl.host}/callcontrol/ws`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        this.ws.on("open", () => {
            this.logger.info("Call Control API websocket connected");
            this.reconnectDelayMs = 5000;
            const { queueDn, queueAgentDns } = this.config.missedCallSms;
            for (const dn of [queueDn, ...queueAgentDns]) {
                this.ws.send(JSON.stringify({ RequestID: `sub-${dn}`, Path: `/callcontrol/${dn}` }));
            }
        });

        this.ws.on("message", (data) => {
            this.handleMessage(data).catch((err) =>
                this.logger.error({ err }, "Error handling Call Control API event")
            );
        });

        this.ws.on("close", (code, reason) => {
            this.logger.warn({ code, reason: reason.toString() }, "Call Control API websocket closed, reconnecting");
            setTimeout(() => this.connect().catch((err) => this.logger.error({ err }, "Reconnect failed")), this.reconnectDelayMs);
            this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 60_000);
        });

        this.ws.on("error", (err) => this.logger.error({ err }, "Call Control API websocket error"));
    }

    async handleMessage(data) {
        let parsed;
        try {
            parsed = JSON.parse(data.toString());
        }
        catch {
            return;
        }
        const event = parsed?.event;
        this.logger.debug({ event }, "Call Control API event received");
        if (!event || event.event_type === 4) {
            return;
        }

        const match = /^\/callcontrol\/([^/]+)\/participants\/(\d+)$/.exec(event.entity ?? "");
        if (!match) {
            return;
        }
        const [, dn, participantIdStr] = match;
        const participantId = Number(participantIdStr);
        const { queueDn } = this.config.missedCallSms;

        if (dn === queueDn) {
            if (event.event_type === 0) {
                await this.trackNewQueueCall(participantId);
            }
            else if (event.event_type === 1) {
                this.scheduleAbandonCheck(participantId);
            }
            return;
        }

        if (event.event_type === 0) {
            await this.checkAgentConnected(dn, participantId);
        }
    }

    async fetchDnParticipants(dn) {
        try {
            const token = await this.getToken();
            const res = await axios.get(`${this.config.missedCallSms.threeCxApiBaseUrl}/callcontrol/${dn}`, {
                headers: { Authorization: `Bearer ${token}` },
                timeout: 10_000
            });
            return res.data?.participants ?? [];
        }
        catch (error) {
            this.logger.warn({ err: error, dn }, "Failed to fetch Call Control API DN state");
            return [];
        }
    }

    async trackNewQueueCall(participantId) {
        const participants = await this.fetchDnParticipants(this.config.missedCallSms.queueDn);
        const info = participants.find((p) => p.id === participantId);
        if (!info) {
            return;
        }
        const existing = this.calls.get(info.callid);
        if (existing) {
            existing.queueParticipantId = participantId;
            existing.callerNumber = info.party_caller_id;
            return;
        }
        this.calls.set(info.callid, {
            queueParticipantId: participantId,
            callerNumber: info.party_caller_id,
            answered: false
        });
    }

    async checkAgentConnected(dn, participantId) {
        const participants = await this.fetchDnParticipants(dn);
        const info = participants.find((p) => p.id === participantId);
        if (!info || info.status !== "Connected") {
            return;
        }
        const call = this.calls.get(info.callid);
        if (call) {
            call.answered = true;
        }
    }

    scheduleAbandonCheck(queueParticipantId) {
        for (const [callid, call] of this.calls.entries()) {
            if (call.queueParticipantId === queueParticipantId) {
                setTimeout(() => {
                    this.finalizeCall(callid).catch((err) =>
                        this.logger.error({ err, callid }, "Failed to finalize queue call")
                    );
                }, this.config.missedCallSms.abandonDecisionDelayMs);
                return;
            }
        }
    }

    async finalizeCall(callid) {
        const call = this.calls.get(callid);
        if (!call) {
            return;
        }
        this.calls.delete(callid);

        if (call.answered) {
            this.logger.info({ callid }, "Queue call was answered -- no SMS needed");
            return;
        }
        if (!call.callerNumber) {
            this.logger.warn({ callid }, "Abandoned queue call had no caller number -- cannot send SMS");
            return;
        }

        const { cooldownMs } = this.config.missedCallSms;
        const lastSent = this.recentlyTexted.get(call.callerNumber);
        if (lastSent && Date.now() - lastSent < cooldownMs) {
            this.logger.info({ callid, to: call.callerNumber }, "Skipping missed-call SMS -- already texted this number recently");
            return;
        }

        try {
            await sendSms(this.config, call.callerNumber, this.config.missedCallSms.message);
            this.recentlyTexted.set(call.callerNumber, Date.now());
            this.logger.info({ callid, to: call.callerNumber }, "Sent missed-call SMS");
        }
        catch (error) {
            this.logger.error({ err: error, callid, to: call.callerNumber }, "Failed to send missed-call SMS");
        }
    }
}
