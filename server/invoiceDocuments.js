import PDFDocument from "pdfkit";

export function invoiceReference(jobId) {
  return "INV-" + String(jobId || "").slice(0, 8).toUpperCase();
}

export function invoiceRecipient(job, client) {
  return String(job.clientEmail || (client && client.email) || "").trim();
}

export function validateInvoice(job, recipient, requireRecipient = true) {
  if (!job || !["invoiced", "completed", "paid"].includes(job.status)) {
    return "Move the job to Invoiced or Completed before sending an invoice.";
  }
  if (!Number.isFinite(Number(job.amount)) || Number(job.amount) <= 0) {
    return "Set a positive invoice value before sending.";
  }
  if (requireRecipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(recipient || ""))) {
    return "Add a valid customer email address to the job or linked client.";
  }
  return null;
}

export async function renderInvoicePdf({ job, client, settings, issuedAt, paidAmount = 0 }) {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: invoiceReference(job.id), Author: String((settings && settings.name) || "V79 Tiquet") } });
  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    doc.on("data", chunk => chunks.push(chunk));
    doc.once("end", () => resolve(Buffer.concat(chunks)));
    doc.once("error", reject);
  });
  const currency = String((settings && settings.currency) || "XCD").toUpperCase();
  const amount = new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(job.amount || 0));
  const date = new Date(issuedAt || Date.now()).toLocaleDateString("en-GB", { timeZone: "America/St_Lucia" });
  doc.fontSize(19).fillColor("#172b4d").text(String((settings && settings.name) || "Your business").slice(0, 150));
  doc.fontSize(9).fillColor("#475569").text(String((settings && settings.address) || "").slice(0, 250));
  doc.text([(settings && settings.email), (settings && settings.phone)].filter(Boolean).join("  |  ").slice(0, 180));
  doc.moveDown(2);
  doc.fontSize(23).fillColor("#0f172a").text("INVOICE");
  doc.fontSize(10).text("Invoice: " + invoiceReference(job.id));
  doc.text("Date: " + date);
  doc.moveDown(1.5);
  doc.fontSize(10).fillColor("#475569").text("BILL TO");
  doc.fontSize(12).fillColor("#0f172a").text(String(job.client || (client && (client.company || client.name)) || "Customer").slice(0, 180));
  if (client && client.name && client.name !== job.client) doc.fontSize(9).text(String(client.name).slice(0, 150));
  if (invoiceRecipient(job, client)) doc.fontSize(9).text(invoiceRecipient(job, client));
  if (client && client.address) doc.fontSize(9).text(String(client.address).slice(0, 240));
  doc.moveDown(1.5);
  doc.fontSize(11).fillColor("#0f172a").text("Service / job");
  doc.fontSize(10).text(String(job.title || "").slice(0, 250));
  if (job.description) doc.moveDown(0.4).fontSize(9).fillColor("#475569").text(String(job.description).slice(0, 950));
  doc.moveDown(1.5);
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor("#cbd5e1").stroke();
  doc.moveDown(0.8);
  doc.fontSize(11).fillColor("#0f172a").text("Invoice total", 48, doc.y, { continued: true }).text(amount, { align: "right" });
  const confirmedPayments = Math.max(0, Number(paidAmount) || 0);
  if (confirmedPayments > 0) {
    const fmt = value => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value);
    doc.moveDown(0.5).fontSize(10).text("Payments recorded: " + fmt(confirmedPayments));
    doc.fontSize(11).text("Balance outstanding: " + fmt(Math.max(0, Number(job.amount || 0) - confirmedPayments)));
  }
  if (job.status === "paid") doc.moveDown().fontSize(10).fillColor("#047857").text("PAID (see payment record for receipt)");
  if (job.invoiceNotes) {
    doc.moveDown(1.5).fontSize(10).fillColor("#0f172a").text("Additional details");
    doc.fontSize(9).fillColor("#475569").text(String(job.invoiceNotes).slice(0, 1300));
  }
  doc.moveDown(2).fontSize(9).fillColor("#475569").text(String((settings && settings.paymentTerms) || "Please pay using the agreed payment method.").slice(0, 600));
  doc.end();
  return finished;
}
