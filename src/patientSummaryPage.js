function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

const PAGE_STYLE = `
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #f4f5f7; margin: 0; padding: 2rem; color: #1a1a1a; }
  .card { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,0.12); overflow: hidden; }
  .header { background: #1f2937; color: #fff; padding: 1.25rem 1.5rem; }
  .header h1 { margin: 0; font-size: 1.25rem; }
  .header p { margin: 0.25rem 0 0; font-size: 0.85rem; color: #9ca3af; }
  .section { padding: 1.25rem 1.5rem; border-top: 1px solid #eee; }
  .section h2 { margin: 0 0 0.75rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
  .field-row { display: flex; justify-content: space-between; padding: 0.3rem 0; font-size: 0.92rem; }
  .field-row .label { color: #6b7280; }
  .field-row .value { text-align: right; font-weight: 500; }
  .appt { padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0; font-size: 0.88rem; }
  .appt:last-child { border-bottom: none; }
  .appt .when { font-weight: 600; }
  .appt .comment { color: #6b7280; font-size: 0.82rem; }
  .empty { color: #9ca3af; font-size: 0.88rem; }
  .cta { display: block; text-align: center; margin: 1.25rem 1.5rem 1.5rem; padding: 0.7rem; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; }
`;

function field(label, value) {
    if (!value) {
        return "";
    }
    return `<div class="field-row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`;
}

function formatAppointmentDate(iso) {
    if (!iso) {
        return "Unknown date";
    }
    try {
        return new Date(iso).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short"
        });
    }
    catch {
        return iso;
    }
}

function renderAppointments(appointments) {
    if (!appointments || appointments.length === 0) {
        return '<p class="empty">No appointments on file.</p>';
    }
    const sorted = [...appointments].sort((a, b) => new Date(b.Start ?? 0) - new Date(a.Start ?? 0));
    return sorted
        .slice(0, 5)
        .map((appt) => {
            const label = appt.Subject || appt.ConsultReason || "Appointment";
            return `<div class="appt">
        <div class="when">${escapeHtml(formatAppointmentDate(appt.Start))}</div>
        <div>${escapeHtml(label)}</div>
        ${appt.Comment ? `<div class="comment">${escapeHtml(appt.Comment)}</div>` : ""}
      </div>`;
        })
        .join("");
}

export function renderPatientSummaryPage({ patient, appointments, chartUrl }) {
    const providerNames = (patient.raw?.Providers ?? []).map((p) => p.Name).join(", ");
    const address = [patient.raw?.Address1, patient.raw?.City, patient.raw?.State, patient.raw?.ZipCode]
        .filter(Boolean)
        .join(", ");

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(patient.fullName)} - Patient Summary</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>${escapeHtml(patient.fullName)}</h1>
      <p>Patient #${escapeHtml(patient.id)}${patient.mrn ? ` &middot; Account ${escapeHtml(patient.mrn)}` : ""}</p>
    </div>
    <div class="section">
      <h2>Patient Info</h2>
      ${field("Date of Birth", patient.dateOfBirth)}
      ${field("Gender", patient.raw?.Gender)}
      ${field("Phone", patient.raw?.PhonePrimary)}
      ${field("Email", patient.raw?.Email)}
      ${field("Address", address)}
      ${field("Status", patient.raw?.Status)}
      ${field("Provider", providerNames)}
    </div>
    <div class="section">
      <h2>Appointments</h2>
      ${renderAppointments(appointments)}
    </div>
    <a class="cta" href="${escapeHtml(chartUrl)}" target="_blank" rel="noopener">Open full chart in 4D EMR</a>
  </div>
</body>
</html>`;
}

export function renderLinkExpiredPage() {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>Link Expired</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Link expired</h1>
      <p>This patient summary link is no longer valid.</p>
    </div>
    <div class="section">
      <p class="empty">Summary links expire shortly after the call ends for patient privacy. Look up the patient directly in 4D EMR instead.</p>
    </div>
  </div>
</body>
</html>`;
}
