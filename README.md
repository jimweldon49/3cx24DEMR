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
- 4D EMR API base URL (`FOURD_EMR_BASE_URL`)
- 4D EMR app/UI base URL (`FOURD_EMR_APP_BASE_URL`)
- 4D EMR credentials (API key, bearer token, or client-id/client-secret headers)
- endpoint mappings for your exact 4D API contract

Optional auth settings:

- `FOURD_EMR_API_KEY`
- `FOURD_EMR_BEARER_TOKEN`
- `FOURD_EMR_CLIENT_ID`
- `FOURD_EMR_CLIENT_SECRET`

Optional behavior settings:

- `FOURD_EMR_TELEPHONE_NOTE_TYPE_ID` (default `2`)
- `FOURD_EMR_DEFAULT_APPOINTMENT_ID` (fallback only)
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
- If your EMR has no dedicated search/new URL, `screenPopUrl` falls back to app home (`.../#`) for search/new actions.

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

Finalizes call handling and pushes transcript into 4D EMR chart notes when patient context exists.

`appointmentId` can be sent when available and will be forwarded to 4D.
By default, the integration does **not** require it (`FOURD_EMR_REQUIRE_APPOINTMENT_ID=false`).
If your 4D tenant requires it, enable strict mode and provide it from your call events.

Possible sources:

- `call-start` payload (`appointmentId`)
- or `call-end` payload (`appointmentId`)
- or configured as `FOURD_EMR_DEFAULT_APPOINTMENT_ID` (not recommended except temporary testing)

```json
{
  "eventId": "evt-003",
  "callId": "call-123",
  "appointmentId": 1111,
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
- `FOURD_EMR_PATIENT_FIRST_NAME_PATH`
- `FOURD_EMR_PATIENT_LAST_NAME_PATH`
- `FOURD_EMR_NOTE_CREATE_PATH_TEMPLATE`
- etc.

This repository is pre-configured with defaults that match the 4D examples you provided:

- Lookup endpoint: `/api/public/patients` (with `page.*` query params)
- Result list path: `Items`
- Patient ID path: `PatientId`
- Name composition: `FirstName` + `LastName`
- Note endpoint: `/api/public/chartNotes`
- Telephone chart note type: `ChartNoteTypeID = 2`

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
