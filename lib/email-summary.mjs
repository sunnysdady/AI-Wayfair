const TEMPLATE_HEADING = /^(?:action required|to do|please note|important|notice)\s*:?\s*$/i;
const TEMPLATE_PREFIX = /^(?:(?:action required|to do|please note|important|notice)\s*:\s*)+/i;
const BOILERPLATE = /(?:carb\b.*tsca|tsca\b.*carb|composite wood.*(?:compliant|compliance)|confidentiality notice|intended recipient|unsubscribe|manage (?:your )?preferences|all rights reserved|do not reply)/i;
const GREETING_OR_SIGNATURE = /^(?:dear\b|hello\b|hi\b|regards\b|best regards\b|sincerely\b|thank you\b|thanks\b|wayfair supplier operations\b)/i;
const IDENTIFIER = /\b(?:po|purchase order|order|invoice|inv|remittance|tracking|case|ticket|claim|reference|ref)\s*(?:number|no\.?|id|#)?\s*[:#-]?\s*[a-z0-9][a-z0-9-]{3,}\b/i;
const AMOUNT = /(?:\b(?:usd|cad|cny|rmb|eur|gbp)\s*[0-9][0-9,]*(?:\.\d{1,2})?\b|\$\s*[0-9][0-9,]*(?:\.\d{1,2})?)/i;
const DEADLINE = /\b(?:due|deadline|by|before|no later than|ship(?:ment)? date|delivery date|payment date)\b|\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|截止|最迟|发货日期|送达日期|付款日期/i;
const ACTION = /\b(?:must|need(?:s)? to|required|please (?:ship|confirm|respond|provide|submit|review|update|cancel|contact)|register and fulfill)\b|需(?:要|在)?|请(?:发货|确认|回复|提供|提交|检查|更新|取消|处理)/i;
const EXCEPTION = /\b(?:delay(?:ed)?|late|overdue|cancel(?:led|ation)?|backorder(?:ed)?|failed|failure|missing|shortage|damaged|rejected|exception|dispute|hold|blocked|risk)\b|延误|逾期|取消|缺货|失败|缺失|破损|拒绝|异常|争议|冻结|风险/i;
const SHIPPING = /\b(?:ship|shipment|shipping|delivery|deliver|carrier|fedex|ups|usps|tracking|freight|pickup|fulfill(?:ment|ed)?)\b|发货|配送|承运|物流|履约|运单/i;
const FINANCE = /\b(?:payment|paid|remittance|invoice|credit|refund|deduction|chargeback|fee|settlement|ach|wire transfer)\b|付款|回款|汇款|发票|退款|扣款|拒付|费用|结算/i;
const DATE_VALUE = /\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2})\b/;

function cleanLine(value) {
  return String(value || "")
    .replace(/[\u034f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/^[\s>*•\-–—]+/, "")
    .replace(TEMPLATE_PREFIX, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonical(value) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function splitLines(value) {
  return String(value || "").split(/\r?\n|(?<=[.!?。！？])\s+/).map(cleanLine).filter(Boolean);
}

function categoryKind(item) {
  const text = `${item.category || ""}\n${item.subject || ""}`;
  if (/订单|履约|物流|配送|order|fulfill|ship|delivery/i.test(text)) return "order";
  if (/财务|账单|回款|付款|扣款|finance|payment|remittance|invoice|chargeback/i.test(text)) return "finance";
  return "other";
}

function money(value, currency = "USD") {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${currency} ${amount.toFixed(2)}` : "";
}

function structuredOrderLines(value, order) {
  const text = String(value || "");
  const po = text.match(/\bPO\s*(?:number|no\.?|#)?\s*[:#-]?\s*([a-z0-9][a-z0-9-]{3,})\b/i);
  const carrier = text.match(/\b(FedEx(?:\s+(?:Home Delivery|Ground|Express))?|UPS(?:\s+Ground)?|USPS|DHL)\b/i);
  const deadline = text.match(DATE_VALUE);
  const orderItems = Array.isArray(order?.items) ? order.items : [];
  if (order && typeof order === "object" && (order.poNumber || po)) {
    const quantity = Number(order.totalQuantity ?? orderItems.reduce((sum, item) => sum + Number(item?.quantity || 0), 0));
    const totalAmount = money(
      order.totalAmount ?? orderItems.reduce((sum, item) => sum + Number(item?.quantity || 0) * Number(item?.unitPrice || 0), 0),
      order.currency || "USD",
    );
    const header = [
      `订单号 ${order.poNumber || po?.[1]}`,
      quantity > 0 ? `数量 ${quantity}` : "",
      totalAmount ? `金额 ${totalAmount}` : "",
      carrier?.[1] || "",
      deadline ? `截止 ${deadline[0]}` : "",
    ].filter(Boolean).join(" · ");
    const itemLines = orderItems.slice(0, 6).map((item) => [
      item?.sku ? `SKU ${item.sku}` : "",
      item?.name ? `商品 ${item.name}` : "",
      Number(item?.quantity) > 0 ? `数量 ${Number(item.quantity)}` : "",
      Number(item?.unitPrice) >= 0 ? `单价 ${money(item.unitPrice, order.currency || "USD")}` : "",
    ].filter(Boolean).join(" · ")).filter(Boolean);
    if (orderItems.length > 6) itemLines.push(`另有 ${orderItems.length - 6} 个 SKU`);
    return [header, ...itemLines].filter(Boolean);
  }
  const lines = [];
  if (po) lines.push(`PO #${po[1]}${carrier ? ` · ${carrier[1]}` : ""}`);
  if (deadline) lines.push(`截止日期 ${deadline[0]}`);
  return lines;
}

function scoreLine(line, kind) {
  let score = 0;
  if (IDENTIFIER.test(line)) score += 8;
  if (AMOUNT.test(line)) score += 7;
  if (kind === "finance" && AMOUNT.test(line)) score += 7;
  if (DEADLINE.test(line)) score += 5;
  if (ACTION.test(line)) score += 5;
  if (EXCEPTION.test(line)) score += 6;
  if (kind === "order" && SHIPPING.test(line)) score += 5;
  if (kind === "finance" && FINANCE.test(line)) score += 5;
  if (kind === "other" && (SHIPPING.test(line) || FINANCE.test(line))) score += 2;
  return score;
}

function structuredFinancialLines(financial) {
  if (!financial || typeof financial !== "object") return [];
  const lines = [];
  if (financial.amount != null) lines.push(`${financial.currency || ""} ${financial.amount}`.trim());
  if (financial.remittanceId) lines.push(`Remittance #${financial.remittanceId}`);
  if (financial.paymentDate) lines.push(`Payment date ${financial.paymentDate}`);
  if (financial.paymentMethod) lines.push(`Payment method ${financial.paymentMethod}`);
  if (Array.isArray(financial.invoiceIds) && financial.invoiceIds.length) lines.push(`Invoices ${financial.invoiceIds.join(", ")}`);
  return lines;
}

function inferredFinancialLines(value) {
  const text = cleanLine(value);
  const remittance = text.match(/\b(?:payment\s+remittance|remittance)\s*[-:#]*\s*#?([0-9]{6,})\b/i);
  const amount = text.match(AMOUNT);
  const paymentDate = text.match(/\b(?:payment date|paid on)\s*[:#-]?\s*([0-9/-]{8,10})\b/i);
  const attachment = text.match(/附件\s*[:：]\s*([^\s；。]+?\.(?:csv|xlsx?|pdf))\b/i);
  const lines = [];
  if (remittance) lines.push(`汇款单 #${remittance[1]}`);
  if (amount) lines.push(`金额 ${amount[0].replace(/\s+/g, " ")}`);
  if (paymentDate) lines.push(`付款日期 ${paymentDate[1]}`);
  if (attachment) lines.push(`附件 ${attachment[1]}`);
  return lines;
}

function clip(value, limit) {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function normalizeEmailBriefItem(item = {}) {
  const kind = categoryKind(item);
  const subject = cleanLine(item.subject);
  const sourceText = [item.subject, item.summary, item.bodyPreview].filter(Boolean).join("\n");
  const structuredLines = kind === "order"
    ? structuredOrderLines(sourceText, item.order)
    : kind === "finance"
      ? [...structuredFinancialLines(item.financial), ...inferredFinancialLines(sourceText)]
      : [];
  const rawLines = [
    ...structuredLines,
    subject,
    ...splitLines(item.summary),
    ...splitLines(item.bodyPreview),
  ];
  const seen = new Set();
  const candidates = [];

  for (const [index, line] of rawLines.entries()) {
    if (!line || TEMPLATE_HEADING.test(line) || BOILERPLATE.test(line) || GREETING_OR_SIGNATURE.test(line)) continue;
    const key = canonical(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ line, index, score: scoreLine(line, kind) });
  }

  const ranked = [...candidates].sort((left, right) => right.score - left.score || left.index - right.index);
  const useful = ranked.filter((candidate) => candidate.score > 0);
  const selected = (useful.length ? useful : ranked).slice(0, 8);
  const structuredKeys = new Set(structuredLines.map(canonical));
  const structured = candidates.filter((candidate) => structuredKeys.has(canonical(candidate.line)));
  const summaryCandidates = structured.length ? structured : selected;
  const summaryLines = summaryCandidates.slice(0, kind === "order" ? 7 : 2).map((candidate) => candidate.line);
  const previewLines = structured.length
    ? structured.map((candidate) => candidate.line)
    : [...selected].sort((left, right) => left.index - right.index).map((candidate) => candidate.line);
  const fallback = subject || cleanLine(item.summary) || cleanLine(item.bodyPreview);

  return {
    ...item,
    summary: clip(summaryLines.join("；") || fallback, 500),
    bodyPreview: clip(previewLines.join("\n") || fallback, 4000),
  };
}
