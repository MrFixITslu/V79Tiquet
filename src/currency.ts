export function currencySymbol(currency?: string): string {
  switch (String(currency || "USD").toUpperCase()) {
    case "XCD":
      return "EC$";
    case "USD":
      return "US$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    default:
      return String(currency || "USD").toUpperCase();
  }
}

export function formatMoney(
  value: number | string | null | undefined,
  currency = "USD",
  options: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {}
): string {
  const numeric = Number(value || 0);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const sign = safe < 0 ? "-" : "";
  const amount = Math.abs(safe).toLocaleString(undefined, {
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  });
  return `${sign}${currencySymbol(currency)} ${amount}`;
}
