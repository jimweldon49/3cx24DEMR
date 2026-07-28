# 3CX v20 + 4D EMR Integration

Connects **3CX v20** call events to **4D EMR** for screen pop and call-transcript writeback, and separately, texts callers whose queue call goes unanswered.

This repo reflects what's actually deployed to the `ca-3cx-4d-prod` Azure Container App (reconciled 2026-07-27 — earlier revisions of this repo drifted from what was live; see git history if you need the story).

---

## Two integration paths

### 1. 3CX CRM Integration Template (`src/routes/crm.js`, mounted at `/crm`)

This is the **primary, currently-active** integration. Configured in 3CX Management Console → Settings → CRM Integration → Server Side, using the "4D EMR" template (XML on file separately, not checked into this repo).

- `GET /crm/lookup?phoneNumber=[Number]&callId=[CallID]` — fires synchronously on every call. Requires header `X-Api-Key` matching `CRM_TEMPLATE_API_KEY`. Returns `ContactId`, `ContactUrl`, `FirstName`, `LastName`, `CompanyName`, `PhoneBusiness`, `MRN`, `DOB`.
- `POST /crm/report-call` — fires on call end, carrying 3CX's own `[Transcription]`/`[Summary]` tokens. Pushes to a 4D EMR Lead (find-or-create by phone number) for every caller, matched patient or not. Chart notes (`/api/public/chartNotes`) were tried first but don't land in a visible category regardless of the type id sent (confirmed by inspection and by 4D EMR support, 2026-07-27) — Leads is the destination 4D EMR support pointed to instead. A matched patient's real name is used for the lead so it's identifiable in the Nourish → Leads list rather than showing as an unknown caller.
- `GET /crm/patient-summary?pid=&exp=&sig=` — a small self-hosted patient summary page. **Not** part of the 3CX template contract — this is what `ContactUrl` points to for a matched patient, instead of linking directly into 4D EMR's own web app.

**Why `/crm/patient-summary` exists:** 4D EMR's web app (`app.4d-emr.com`) scopes its authenticated session to a per-tab `TabId` in `sessionStorage`, with no return-to-URL after login. A browser tab opened fresh by 3CX always hits their login screen and, after logging in, lands on a generic home page — never the intended patient. 4D EMR support confirmed (2026-07-27) this is deliberate (no SSO, citing HIPAA risk) and pointed to how Weave Communications integrates: pull patient data via the API, render it yourself, rather than deep-linking into 4D EMR's session. `/crm/patient-summary` does exactly that — server-rendered from `/api/public/patients/{id}`, `/api/public/appointments?patientId={id}`, and previous call notes (see below), with a link through to the real 4D EMR chart for when an agent needs to actually edit the record.

**Previous calls on the summary page:** 4D EMR's Leads API has no lookup-by-phone or lookup-by-id — the only way to find a caller's lead again is to remember the id from when it was created. `src/leadIdStore.js` persists that phone → leadId mapping in Azure Table Storage (falls back to memory-only if `AZURE_STORAGE_CONNECTION_STRING` isn't set) specifically so this survives restarts/redeploys and previous call notes (`GET /api/public/leads/notes?leadId=`) can be pulled back for the summary page, not just so repeat callers don't create duplicate leads.

Because this page is opened by a bare browser navigation (not a server-to-server call from 3CX), it can't carry the `X-Api-Key` header. It's protected instead by a short-lived HMAC-signed token (`patientSummaryLink.js`) so patient data isn't exposed via a guessable `?pid=NNN` URL. Links expire after `PATIENT_SUMMARY_LINK_TTL_MINUTES` (default 30).

### 2. Call Flow Designer webhooks (`src/routes/webhooks.js`, mounted at `/webhooks`)

An older, separate integration path — a 3CX Call Flow Designer script POSTs call events here directly instead of going through the CRM template. Kept for compatibility; not required if the CRM template above is configured.

- `POST /webhooks/3cx/call-start`
- `POST /webhooks/3cx/transcript`
- `POST /webhooks/3cx/call-end`
- `GET /webhooks/screen-pop/:callId`

Optional HMAC signature validation via `THREE_CX_WEBHOOK_SECRET` (`x-3cx-signature` header).

### 3. Missed-call SMS (`src/callControlListener.js`, no HTTP route — a long-lived background process)

Independent feature, unrelated to 4D EMR: when a call to queue `THREE_CX_QUEUE_DN` is abandoned (rings, nobody answers, caller hangs up), automatically text the caller via Voxtelesys so they can reply and route back into the queue (reply-routing is native 3CX DID-to-queue SMS behavior, not something this service does).

**Why this needs the Call Control API, not just Call Flow Designer:** native 3CX queues hand the call to a subsystem CFD can't see into — confirmed both by 3CX community consensus and empirically (a CFD flow only knows about a call while it's flowing through that script). The only way to detect an abandoned queue call is the [Call Control API](https://www.3cx.com/docs/call-control-api/) (the xAPI/WebSocket variant — needs an 8SC+ Enterprise license, and supports secure remote access, unlike the older localhost-only .NET version).

**Detection rule** (derived empirically 2026-07-28 by watching real answered vs. abandoned calls side by side, not from docs — see the comment block at the top of `callControlListener.js` for the full walkthrough): a call ringing into the queue also rings every monitored agent extension (`status: "Ringing"` on each, same `callid`). If answered, exactly one extension transitions to `status: "Connected"` while every other leg — including the queue's own — gets dropped at that same moment. If abandoned, every leg drops while still `"Ringing"`; no extension ever reaches `"Connected"`. `THREE_CX_QUEUE_AGENT_DNS` **must list every extension that's a member of the queue** — an unmonitored extension answering a call would incorrectly look abandoned.

**Sending the SMS** goes through Voxtelesys's Messaging API directly (`VOXTELESYS_SMS_API_URL`), not through 3CX. Important: a number that works fine for *inbound* SMS via 3CX's own SMS trunk config is **not** automatically valid as the `from` sender here — confirmed 2026-07-28 that `+19163477001` (configured/working in 3CX's SMS tab) 404s `"from" not found` against this API, while `+19166643391` (the practice's main line) works. Test any new `VOXTELESYS_SMS_FROM_NUMBER` before relying on it.

Disabled by default (`MISSED_CALL_SMS_ENABLED=false`) since enabling it means real callers start receiving real texts — flip it on deliberately, not as a side effect of deploying.

---

## Quick start

```bash
npm install
cp .env.example .env   # fill in your 3CX/4D EMR values
npm run dev             # or: npm start
```

Health check: `GET /health`

---

## 4D EMR API mapping

`src/config.js` exposes env-driven mappings so you can adapt to your exact 4D API shape without changing code — see `.env.example` for the full list (patient lookup path/params, screen-pop URL template, appointment lookup, lead endpoints, etc).

Auth to 4D EMR supports API key, bearer token, OAuth2 client-credentials, or up to three custom headers (`client-id` / `client-secret` / a third header like `Subscription-key` — whatever your 4D tenant requires).

---

## Deployment

Deployed as an Azure Container App (`ca-3cx-4d-prod`), built via `az acr build` (no local Docker required) and rolled out with `az containerapp update --image ...`. `docs/deploy-azure-app-service.md` describes an alternative App Service deployment path that was not actually used for the current production instance.

---

## Production guidance

- In-memory sessions/idempotency store (`CallSessionStore`, `EventIdStore`) are fine for a single instance. Move to Redis before scaling to multiple replicas.
- Keep `CRM_TEMPLATE_API_KEY`, 4D EMR credentials, `THREE_CX_CC_CLIENT_SECRET`, and `VOXTELESYS_SMS_API_KEY` in Container App secrets/App Settings, not committed anywhere.
- `/crm/patient-summary` renders real PHI — don't widen its TTL casually, and don't log full URLs (they contain a valid signed token) anywhere persistent.
