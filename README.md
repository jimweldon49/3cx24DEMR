# 3CX v20 + 4D EMR Integration

This repository now contains a production-ready starter service that connects **3CX v20 call events** to **4D EMR**:

1. **Call start:** lookup patient by caller phone and return screen-pop context.
2. **During/after call:** accept transcript payloads.
3. **Call end:** write transcript into the matching patient chart in 4D EMR.

---

## What this service does

- Exposes secure webhook endpoints for 3CX event ingestion.
- Validates webhook signatures (HMAC SHA-256) when a shared secret is configured.
- Uses an in-memory session store per call (`callId`) to correlate start/transcript/end events.
- Supports idempotency for repeated webhook events via `eventId`.
- Supports configurable screen-pop behavior:
  - single match -> open patient chart
  - multiple matches -> pick-list/search/open-first
  - no match -> new-patient/search/none
- Redacts SSNs from transcript text before writeback when enabled.
- Uses configurable response-path mappings so you can adapt to your exact 4D EMR API shape without changing code.

---

## Quick start

### 1) Install

```bash
npm install
```

### 2) Configure environment

```bash
cp .env.example .env
```

Populate `.env` with your:

- 3CX tenant URL
- 4D EMR base URL
- 4D EMR credentials (API key, static bearer token, or OAuth client credentials)
- correct lookup/create endpoint mappings for your 4D API contract

If 4D EMR uses OAuth client credentials, set:

- `FOURD_EMR_OAUTH_TOKEN_URL`
- `FOURD_EMR_OAUTH_CLIENT_ID`
- `FOURD_EMR_OAUTH_CLIENT_SECRET`
- optional: `FOURD_EMR_OAUTH_SCOPE`, `FOURD_EMR_OAUTH_AUDIENCE`
- optional behavior settings:
  - `FOURD_EMR_TRANSCRIPT_NOTE_TYPE`
  - `SCREEN_POP_MULTI_MATCH_ACTION`
  - `SCREEN_POP_NO_MATCH_ACTION`
  - `REDACT_SSN_IN_TRANSCRIPTS`

### 3) Run locally

```bash
npm run dev
```

For production:

```bash
npm run build
npm start
```

Health check:

- `GET /health`

---

## Webhook endpoints

Base route: `/webhooks`

### `POST /webhooks/3cx/call-start`

Looks up patient by caller number and returns screen-pop details:

- `screenPopAction: open_patient | pick_list | new_patient | search | none`
- `screenPopUrl` resolved from template(s)
- `matchCandidates` when multiple patients are found

Example payload:

```json
{
  "eventId": "evt-001",
  "callId": "call-123",
  "fromNumber": "+15551234567",
  "toNumber": "+15557654321",
  "direction": "inbound",
  "agentExtension": "101",
  "startedAt": "2026-06-04T17:00:00.000Z",
  "metadata": {
    "queue": "front-desk"
  }
}
```

### `POST /webhooks/3cx/transcript`

Stores transcript text for an active call session (or accepts early if call-start not seen yet).

```json
{
  "eventId": "evt-002",
  "callId": "call-123",
  "transcript": "Patient is requesting refill for medication..."
}
```

### `POST /webhooks/3cx/call-end`

Finalizes call handling and pushes transcript into 4D EMR patient chart when patient context exists.

```json
{
  "eventId": "evt-003",
  "callId": "call-123",
  "endedAt": "2026-06-04T17:06:00.000Z"
}
```

### `GET /webhooks/screen-pop/:callId`

Returns call context, chosen screen-pop action, patient context (if selected), candidate list (if multiple), and screen-pop URL.

---

## 3CX configuration notes

3CX implementations vary by deployment pattern (CFD app, webhook relay, middle-tier integration), but the standard pattern is:

1. Send call start events to `POST /webhooks/3cx/call-start`.
2. Send transcript events (if generated separately) to `POST /webhooks/3cx/transcript`.
3. Send call completion events to `POST /webhooks/3cx/call-end`.
4. Use the `screenPopUrl` value from call-start response in the agent desktop/flow to open the patient chart.

If you set `THREE_CX_WEBHOOK_SECRET`, include a signature header:

- `x-3cx-signature: sha256=<hex-hmac-of-raw-json-body>`

---

## 4D EMR mapping notes

`src/config.ts` supports mapping fields to avoid hardcoding a specific 4D schema:

- `FOURD_EMR_PATIENT_LOOKUP_RESULT_PATH`
- `FOURD_EMR_PATIENT_ID_PATH`
- `FOURD_EMR_PATIENT_NAME_PATH`
- `FOURD_EMR_NOTE_CREATE_PATH_TEMPLATE`
- etc.

If your 4D API response differs, update `.env` mapping values first.  
If payload shape for note creation differs, adjust `appendTranscriptToPatientChart()` in:

- `src/clients/fourd-emr-client.ts`

---

## Important production guidance

- In-memory sessions are suitable for single-instance deployment.  
  For HA/multi-instance workloads, replace `CallSessionStore` and `EventIdStore` with Redis.
- Put this service behind TLS and IP allow-list inbound webhook traffic where possible.
- Keep API credentials in a secret manager; avoid plaintext secrets in files.

---

## Azure deployment

If your organization uses Azure, see:

- `docs/deploy-azure-app-service.md`
