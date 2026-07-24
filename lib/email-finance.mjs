const PENDING = "待邮件同步";

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parsedAmount(text) {
  const leading = text.match(/\b(USD|CAD|CNY|RMB)\s*([0-9][0-9,]*(?:\.\d{1,2})?)\b/i)
    || text.match(/(\$)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/);
  if (leading) return { currency: leading[1] === "$" ? "USD" : leading[1].toUpperCase(), amount: Number(leading[2].replaceAll(",", "")) };
  const trailing = text.match(/\b([0-9][0-9,]*(?:\.\d{1,2})?)\s*(USD|CAD|CNY|RMB)\b/i);
  return trailing ? { currency: trailing[2].toUpperCase(), amount: Number(trailing[1].replaceAll(",", "")) } : null;
}

function amountLabel(amount, currency) {
  if (!Number.isFinite(amount) || amount < 0) return PENDING;
  if (!currency) return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}（币种待同步）`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
  }
}

export function financialDetailsForEmail(email = {}) {
  const financial = email.financial && typeof email.financial === "object" ? email.financial : {};
  const text = [email.category, email.subject, email.summary, email.bodyPreview].filter(Boolean).join("\n");
  const isFinancial = Object.keys(financial).length > 0 || /payment\s+remittance|remittance|invoice|账单|回款|汇款|付款|财务/i.test(text);
  if (!isFinancial) return { isFinancial: false };

  const remittanceMatch = text.match(/remittance[^\n#\d]{0,24}#?\s*(\d{8,})/i) || text.match(/(?:汇款单号|汇款编号)\s*[:：#]?\s*([A-Z0-9-]{6,})/i);
  const extractedAmount = parsedAmount([email.summary, email.bodyPreview].filter(Boolean).join("\n"));
  const explicitAmount = typeof financial.amount === "number" && Number.isFinite(financial.amount) && financial.amount >= 0 ? financial.amount : null;
  const currency = stringValue(financial.currency).toUpperCase() || extractedAmount?.currency || "";
  const amount = explicitAmount ?? extractedAmount?.amount ?? null;
  const explicitInvoices = Array.isArray(financial.invoiceIds) ? financial.invoiceIds.map(stringValue).filter(Boolean) : [];
  const extractedInvoices = [...text.matchAll(/\bINV[-\s]?\d{3,}\b/gi)].map((match) => match[0].replace(/\s+/g, "-"));

  return {
    isFinancial: true,
    remittanceId: stringValue(financial.remittanceId) || remittanceMatch?.[1] || PENDING,
    amountLabel: amountLabel(amount, currency),
    currency: currency || PENDING,
    paymentDate: stringValue(financial.paymentDate) || PENDING,
    paymentMethod: stringValue(financial.paymentMethod) || PENDING,
    invoiceIds: [...new Set(explicitInvoices.length ? explicitInvoices : extractedInvoices)],
  };
}
