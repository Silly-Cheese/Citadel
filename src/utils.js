export const esc = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export const initials = (name = "Citadel") => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "C") + (parts[1]?.[0] || "");
};

export const fmtDate = (value) => {
  if (!value) return "—";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
};

export const fmtDateTime = (value) => {
  if (!value) return "—";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
};

export const statusBadge = (status = "Unknown") => {
  const s = String(status).toLowerCase();
  const tone = ["active","approved","resolved","closed"].includes(s)
    ? "success"
    : ["pending","in progress","pending customer","pending internal"].includes(s)
      ? "warning"
      : ["suspended","denied","restricted","escalated"].includes(s)
        ? "danger"
        : "info";
  return `<span class="badge ${tone}">${esc(status)}</span>`;
};

export const classificationBadge = (value = "STANDARD") => {
  const v = String(value).toUpperCase();
  const tone = ["RESTRICTED","HIGHLY_RESTRICTED"].includes(v)
    ? "danger"
    : ["CONFIDENTIAL","SENSITIVE"].includes(v)
      ? "warning"
      : "info";
  return `<span class="badge ${tone}">${esc(v.replaceAll("_"," "))}</span>`;
};

export const customerDisplayName = (c = {}) =>
  c.displayName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed customer";
