// One private invoice copy recipient per workspace. Never use a global BCC.
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[A-Za-z]{2,}$/;

export function normalizeInvoiceCopyEmail(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "string") throw new Error("Invoice copy email must be a single email address.");
  const address = value.trim().toLowerCase();
  if (!address) return "";
  if (address.length > 254 || !EMAIL.test(address)) {
    throw new Error("Enter one valid invoice copy email address (no lists or extra recipients).");
  }
  return address;
}

export function invoiceBccForWorkspace(settings, customerEmail) {
  const bcc = normalizeInvoiceCopyEmail(settings && settings.invoiceCopyEmail);
  return bcc && bcc !== String(customerEmail || "").trim().toLowerCase() ? bcc : null;
}

// Dates are calendar dates only (not UTC timestamps), avoiding off-by-one errors.
export function parseDueDate(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Select a valid due date (YYYY-MM-DD), or clear it.");
  }
  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("The selected due date does not exist on the calendar.");
  }
  return value;
}
