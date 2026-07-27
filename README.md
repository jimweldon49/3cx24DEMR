# 3CX v20 + 4D EMR Integration

Connects **3CX v20** call events to **4D EMR** for screen pop and call-transcript writeback.

This repo reflects what's actually deployed to the `ca-3cx-4d-prod` Azure Container App (reconciled 2026-07-27 — earlier revisions of this repo drifted from what was live; see git history if you need the story).

---

## Two integration paths

### 1. 3CX CRM Integration Template (`src/routes/crm.js`, mounted at `/crm`)

This is the **primary, currently-active** integration. Configured in 3CX Management Console → Settings → CRM Integration → Server Side, using the "4D EMR" template (XML on file separately, not checked into this repo).

- `GET /crm/lookup?phoneNumber=[Number]&callId=[CallID]` — fires synchronously on every call. Requires header `X-Api-Key` matching `CRM_TEMPLATE_API_KEY`. Returns `ContactId`, `ContactUrl`, `FirstName`, `LastName`, `CompanyName`, `PhoneBusiness`, `MRN`, `DOB`.
- `POST /crm/report-call` — fires on call end, carrying 3CX's own `[Transcription]`/`[Summary]` tokens. Pushes to a 4D EMR Lead (find-or-create by phone number) for every caller, matched patient or not. Chart notes (`/api/public/chartNotes`) were tried first but don't land in a visible category regardless of the type id sent (confirmed by inspection and by 4D EMR support, 2026-07-27) — Leads is the destination 4D EMR support pointed to instead. A matched patient's real name is used for the lead so it's identifiable in the Nourish → Leads list rather than showing as an unknown caller.
- `GET /crm/patient-summary?pid=&exp=&sig=` — a small self-hosted patient summary page. **Not** part of the 3CX template contract — this is what `ContactUrl` points to for a matched patient, instead of linking directly into 4D EMR's own web app.

**Why `/crm/patient-summary` exists:** 4D EMR's web app (`app.4d-emr.com`) scopes its authenticated session to a per-tab `TabId` in `sessionStorage`, with no return-to-URL after login. A browser tab opened fresh by 3CX always hits their login screen and, after logging in, lands on a generic home page — never the intended patient. 4D EMR support confirmed (2026-07-27) this is deliberate (no SSO, citing HIPAA risk) and pointed to how Weave Communications integrates: pull patient data via the API, render it yourself, rather than deep-linking into 4D EMR's session. `/crm/patient-summary` does exactly that — server-rendered from `/api/public/patients/{id}` and `/api/public/appointments?patientId={id}`, with a link through to the real 4D EMR chart for when an agent needs to actually edit the record.

Because this page is opened by a bare browser navigation (not a server-to-server call from 3CX), it can't carry the `X-Api-Key` header. It's protected instead by a short-lived HMAC-signed token (`patientSummaryLink.js`) so patient data isn't exposed via a guessable `?pid=NNN` URL. Links expire after `PATIENT_SUMMARY_LINK_TTL_MINUTES` (default 30).

### 2. Call Flow Designer webhooks (`src/routes/webhooks.js`, mounted at `/webhooks`)

An older, separate integration path — a 3CX Call Flow Designer script POSTs call events here directly instead of going through the CRM template. Kept for compatibility; not required if the CRM template above is configured.

- `POST /webhooks/3cx/call-start`
- `POST /webhooks/3cx/transcript`
- `POST /webhooks/3cx/call-end`
- `GET /webhooks/screen-pop/:callId`

Optional HMAC signature validation via `THREE_CX_WEBHOOK_SECRET` (`x-3cx-signature` header).

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
- Keep `CRM_TEMPLATE_API_KEY` and 4D EMR credentials in Container App secrets/App Settings, not committed anywhere.
- `/crm/patient-summary` renders real PHI — don't widen its TTL casually, and don't log full URLs (they contain a valid signed token) anywhere persistent.
