# Deploy to Azure App Service (Container)

This guide deploys the integration to **Azure App Service for Containers** with secrets in **App Settings** (or Key Vault references).

---

## 1) What you will create

- 1 Azure Container Registry (ACR)
- 1 Azure App Service Plan (Linux)
- 1 Web App (Linux, custom container)
- App Settings for all integration environment variables

---

## 2) Build and push container image

Use Azure Cloud Shell or local terminal with Azure CLI logged in.

```bash
az group create --name rg-3cx-4d --location eastus

az acr create \
  --resource-group rg-3cx-4d \
  --name acr3cx4d \
  --sku Basic \
  --admin-enabled true

az acr login --name acr3cx4d

docker build -t acr3cx4d.azurecr.io/3cx-4d-emr:latest .
docker push acr3cx4d.azurecr.io/3cx-4d-emr:latest
```

> Replace `acr3cx4d` with a globally unique registry name.

---

## 3) Create App Service and point to the image

```bash
az appservice plan create \
  --name plan-3cx-4d \
  --resource-group rg-3cx-4d \
  --is-linux \
  --sku B1

az webapp create \
  --resource-group rg-3cx-4d \
  --plan plan-3cx-4d \
  --name app-3cx-4d-integration \
  --deployment-container-image-name acr3cx4d.azurecr.io/3cx-4d-emr:latest
```

---

## 4) Configure container registry credentials on Web App

```bash
ACR_USER=$(az acr credential show --name acr3cx4d --query "username" -o tsv)
ACR_PASS=$(az acr credential show --name acr3cx4d --query "passwords[0].value" -o tsv)

az webapp config container set \
  --name app-3cx-4d-integration \
  --resource-group rg-3cx-4d \
  --container-image-name acr3cx4d.azurecr.io/3cx-4d-emr:latest \
  --container-registry-url https://acr3cx4d.azurecr.io \
  --container-registry-user "$ACR_USER" \
  --container-registry-password "$ACR_PASS"
```

---

## 5) Set required App Settings (environment variables)

Set at minimum:

```bash
az webapp config appsettings set \
  --resource-group rg-3cx-4d \
  --name app-3cx-4d-integration \
  --settings \
    WEBSITES_PORT=8080 \
    PORT=8080 \
    LOG_LEVEL=info \
    THREE_CX_TENANT_URL=https://ops-3cxhosted62.3cx.us:5001 \
    THREE_CX_WEBHOOK_SECRET=<set-this> \
    FOURD_EMR_BASE_URL=https://api.4d-emr.com \
    FOURD_EMR_APP_BASE_URL=https://app.4d-emr.com \
    FOURD_EMR_CLIENT_ID=<set-this> \
    FOURD_EMR_CLIENT_SECRET=<set-this> \
    FOURD_EMR_CLIENT_ID_HEADER=x-client-id \
    FOURD_EMR_CLIENT_SECRET_HEADER=x-client-secret \
    FOURD_EMR_TELEPHONE_NOTE_TYPE_ID=2 \
    SCREEN_POP_MULTI_MATCH_ACTION=pick_list \
    SCREEN_POP_NO_MATCH_ACTION=new_patient \
    REDACT_SSN_IN_TRANSCRIPTS=true
```

Then set 4D mapping fields:

- `FOURD_EMR_PATIENT_LOOKUP_PATH`
- `FOURD_EMR_PATIENT_LOOKUP_PHONE_PARAM`
- `FOURD_EMR_PATIENT_LOOKUP_RESULT_PATH`
- `FOURD_EMR_PATIENT_LOOKUP_PAGE_COUNT`
- `FOURD_EMR_PATIENT_LOOKUP_PAGE_SKIP`
- `FOURD_EMR_PATIENT_LOOKUP_NEED_TOTAL_COUNT`
- `FOURD_EMR_PATIENT_ID_PATH`
- `FOURD_EMR_PATIENT_NAME_PATH` (or first/last below)
- `FOURD_EMR_PATIENT_FIRST_NAME_PATH`
- `FOURD_EMR_PATIENT_LAST_NAME_PATH`
- `FOURD_EMR_PATIENT_MRN_PATH`
- `FOURD_EMR_PATIENT_DOB_PATH`
- `FOURD_EMR_PATIENT_CHART_PATH`
- `FOURD_EMR_SCREEN_POP_PATH_TEMPLATE`
- `FOURD_EMR_PATIENT_SEARCH_PATH_TEMPLATE`
- `FOURD_EMR_NEW_PATIENT_PATH_TEMPLATE`
- `FOURD_EMR_NOTE_CREATE_PATH_TEMPLATE`

> 4D `/api/public/chartNotes` requires `AppointmentId`. Ensure 3CX payload includes `appointmentId` on call-start or call-end, or configure a temporary fallback with `FOURD_EMR_DEFAULT_APPOINTMENT_ID`.

---

## 6) Verify service health

Find URL:

```bash
az webapp show \
  --resource-group rg-3cx-4d \
  --name app-3cx-4d-integration \
  --query defaultHostName -o tsv
```

Then check:

- `https://<your-app-hostname>/health`

Expected response includes: `"status":"ok"`.

---

## 7) Configure 3CX webhooks

Point 3CX/your relay to:

- `POST https://<your-app-hostname>/webhooks/3cx/call-start`
- `POST https://<your-app-hostname>/webhooks/3cx/transcript`
- `POST https://<your-app-hostname>/webhooks/3cx/call-end`

Use the same shared secret value as `THREE_CX_WEBHOOK_SECRET`.

---

## 8) Production hardening checklist

- Use Key Vault references in App Settings for secrets.
- Restrict inbound sources where possible.
- Enable App Service log streaming + Application Insights.
- Rotate 4D credentials and webhook secret periodically.
- Move in-memory session/idempotency stores to Redis before multi-instance scaling.
