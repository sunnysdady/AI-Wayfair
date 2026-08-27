import { financialDailySummary, normalizeEmailBriefItem } from "./email-summary.mjs";
import { lingxingDate, lingxingDayStart } from "./lingxing-business-time.mjs";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const DAY_MS = 86_400_000;
const WAYFAIR_DOMAINS = new Set([
  "wayfair.com",
  "service.wayfair.com",
  "partners.wayfair.com",
]);
const MAX_REMITTANCE_ATTACHMENT_BYTES = 1_000_000;
const MAX_EMAIL_BODY_TEXT_CHARS = 120_000;

function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\r" || character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function numericCell(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const parenthesized = /^\((.+)\)$/.exec(normalized);
  const parsed = Number(parenthesized ? `-${parenthesized[1]}` : normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function columnIndex(headers, pattern) {
  return headers.findIndex((header) => pattern.test(String(header || "").trim()));
}

export function parseWayfairRemittanceCsv(text) {
  const source = String(text || "");
  const remittanceId = source.match(
    /Wayfair\s+Remittance\s*#\s*:\s*([A-Z0-9-]{6,})/i,
  )?.[1];
  if (!remittanceId) return null;

  const rows = csvRows(source);
  const totalRow = rows.find((row) => /^Total\s*\([A-Z]{3}\)\s*:/i.test(String(row[0] || "").trim()));
  const currency = String(totalRow?.[0] || "").match(/\(([A-Z]{3})\)/i)?.[1]?.toUpperCase() || "";
  const amount = numericCell(totalRow?.[1]);
  const paymentMethod = totalRow
    ?.map((value) => String(value || "").trim())
    .join(" ")
    .match(/To be sent via\s+(.+)$/i)?.[1]
    ?.trim() || "";
  const paymentDate = source.match(/^Date:\s*(\d{4}-\d{2}-\d{2})\s*$/im)?.[1] || "";
  const epdRow = rows.find((row) => /^EPD Amount\s*\([A-Z]{3}\)\s*:/i.test(String(row[0] || "").trim()));
  const epdAmount = numericCell(epdRow?.[1]);

  const headerIndex = rows.findIndex((row) => /^Invoice\s*#$/i.test(String(row[0] || "").trim()));
  const headers = headerIndex >= 0 ? rows[headerIndex] : [];
  const productIndex = columnIndex(headers, /^Product Amount$/i);
  const allowanceIndex = columnIndex(headers, /^Wayfair Allowance/i);
  const serviceFeeIndex = columnIndex(headers, /^Other$/i);
  const subtotalRow = rows.slice(Math.max(0, headerIndex + 1)).find(
    (row) => row.some((value) => /^Sub-total\s*:$/i.test(String(value || "").trim())),
  );
  const parsedInvoiceIds = headerIndex >= 0
    ? rows.slice(headerIndex + 1)
      .filter((row) => row[0] && !row.some((value) => /^Sub-total\s*:$/i.test(String(value || "").trim())))
      .map((row) => String(row[0]).trim())
      .filter((value) => /^[A-Z0-9-]{6,}$/i.test(value))
    : [];

  const result = {
    remittanceId,
    amount,
    currency,
    paymentDate,
    paymentMethod,
    invoiceIds: [...new Set(parsedInvoiceIds)],
    grossAmount: numericCell(subtotalRow?.[productIndex]),
    allowanceAmount: numericCell(subtotalRow?.[allowanceIndex]),
    epdAmount,
    serviceFeeAmount: numericCell(subtotalRow?.[serviceFeeIndex]),
  };
  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== null && value !== ""),
  );
}

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function senderAddress(message) {
  return String(
    message.from?.emailAddress?.address
      || message.sender?.emailAddress?.address
      || "",
  );
}

function senderDomain(message) {
  return senderAddress(message).toLowerCase().split("@").at(-1) || "";
}

function isWayfairMessage(message) {
  if (WAYFAIR_DOMAINS.has(senderDomain(message))) return true;
  const identity = `${senderAddress(message)} ${message.from?.emailAddress?.name || ""} ${message.subject || ""}`;
  return /wayfair partner home|wayfair partner support/i.test(identity);
}

function messageText(message) {
  return [
    message.subject,
    message.bodyPreview,
    messageBodyText(message),
  ].filter(Boolean).join("\n");
}

function messageBodyText(message) {
  const content = String(message.body?.content || "");
  if (!content) return "";
  return content
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_match, hexadecimal, decimal) => {
      const codePoint = Number.parseInt(hexadecimal || decimal, hexadecimal ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : " ";
    })
    .replace(/\r\n?/g, "\n")
    .replace(/[\t \f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EMAIL_BODY_TEXT_CHARS);
}

function categoryFor(message) {
  const text = messageText(message);
  if (/purchase order|\bPO#|\bPO\s*#|overdue order|must ship|fulfill/i.test(text)) return "订单履约";
  if (/remittance|payment|invoice|billing|回款|账单/i.test(text)) return "账单/回款";
  if (/deduction|chargeback|return|replacement|refund|售后|扣款/i.test(text)) return "售后/扣款";
  if (/compliance|performance|violation|policy|suspend|绩效|合规/i.test(text)) return "绩效/合规";
  if (/advertis|campaign|promotion|discount|black friday|lost sales|inventory gap|活动|广告/i.test(text)) return "活动/广告机会";
  return "其他运营";
}

function dueDateFor(message) {
  const text = messageText(message);
  const match = text.match(
    /(?:must ship by|due(?: date)?|deadline)\s*[:–-]?\s*(\d{2}\/\d{2}\/\d{4}|[A-Z][a-z]{2}\s+\d{1,2},\s*\d{4}|\d{4}-\d{2}-\d{2})/i,
  );
  return match?.[1] || "";
}

function normalizedDueDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString().slice(0, 10);
}

function priorityFor(message, today) {
  const text = messageText(message);
  if (/account suspended|immediate suspension|fraud|security incident/i.test(text)) return "P0";
  const due = normalizedDueDate(dueDateFor(message));
  if (
    /overdue order|deduction approaching settlement|action required/i.test(text)
    || due && due <= today
  ) return "P1";
  if (/review|confirm|opportunity|remittance|payment|campaign|discount|inventory gap/i.test(text)) return "P2";
  return "P3";
}

function summaryFor(message) {
  const category = categoryFor(message);
  const due = dueDateFor(message);
  const preview = (messageBodyText(message) || String(message.bodyPreview || ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
  const attachment = message.attachmentNames?.length
    ? `附件：${message.attachmentNames.join("、")}。`
    : message.hasAttachments
      ? "邮件含附件；未读取附件内容。"
      : "";
  const deadline = due ? `明确日期：${due}。` : "";
  const fallback = preview || "邮件已纳入 Wayfair 运营范围，未提取到更多可验证正文事实。";
  return `${category}：${fallback} ${deadline}${attachment}`.trim();
}

function taskFor(message, today) {
  const text = messageText(message);
  const due = dueDateFor(message);
  if (!/action required|must ship|overdue|review|confirm|acknowledge|check|submit|register|fulfill/i.test(text)) return null;
  return {
    id: `task-${message.id}`,
    title: `处理：${String(message.subject || "Wayfair 邮件").slice(0, 220)}`,
    owner: "未指定",
    dueDate: due || "未注明",
    priority: priorityFor(message, today),
    status: "待处理",
  };
}

function sectionsFor(items, tasks) {
  if (!items.length) return [];
  const sections = [];
  const risks = items.filter((item) => item.priority === "P0" || item.priority === "P1");
  const finance = items.filter((item) => item.category === "账单/回款" || item.category === "售后/扣款");
  const compliance = items.filter((item) => item.category === "绩效/合规");
  const opportunities = items.filter((item) => item.category === "活动/广告机会");

  if (risks.length) {
    sections.push({
      title: "最高风险",
      tone: "risk",
      body: `${risks.length} 项高优先级事项：${risks.map((item) => item.subject).join("；")}。下一步：按邮件中的明确要求和日期处理。`,
    });
  }
  if (finance.length) {
    sections.push({
      title: "财务/回款",
      tone: "finance",
      body: finance.map((item) => financialDailySummary(item) || item.summary).join("；"),
    });
  }
  if (compliance.length) {
    sections.push({
      title: "系统/绩效/合规",
      tone: "risk",
      body: compliance.map((item) => item.summary).join(" "),
    });
  }
  if (opportunities.length) {
    sections.push({
      title: "活动/广告机会",
      tone: "opportunity",
      body: opportunities.map((item) => item.summary).join(" "),
    });
  }
  if (items.length) {
    sections.push({
      title: "管理层速览",
      body: `共 ${items.length} 封 Wayfair 运营邮件，形成 ${tasks.length} 项待办；最高优先级 ${items.some((item) => item.priority === "P0") ? "P0" : items.some((item) => item.priority === "P1") ? "P1" : "P2/P3"}。`,
    });
  }
  sections.push({
    title: "检查范围",
    body: "Microsoft Graph 已检查收件箱及名称含 Wayfair 的自定义文件夹，并覆盖领星站点时间近三日。",
  });
  return sections.slice(0, 6);
}

export function selectTargetMailFolders(folders) {
  return folders.filter((folder) => {
    const name = String(folder.displayName || folder.display_name || "");
    return folder.wellKnownName === "inbox"
      || folder.well_known_name === "inbox"
      || /^(inbox|收件箱)$/i.test(name)
      || /wayfair/i.test(name);
  });
}

export function buildDailyReports(messages, today) {
  const dates = [today, addDays(today, -1), addDays(today, -2)];
  const unique = [...new Map(messages.filter(isWayfairMessage).map((message) => [message.id, message])).values()];

  return dates.map((briefDate) => {
    const dayMessages = unique
      .filter((message) => lingxingDate(message.receivedDateTime) === briefDate)
      .sort((left, right) => String(right.receivedDateTime).localeCompare(String(left.receivedDateTime)));
    const items = dayMessages.map((message) => normalizeEmailBriefItem({
      id: String(message.id),
      category: categoryFor(message),
      subject: String(message.subject || ""),
      sender: senderAddress(message),
      receivedAt: String(message.receivedDateTime),
      unread: !message.isRead,
      priority: priorityFor(message, today),
      summary: summaryFor(message),
      owner: "未指定",
      status: "待处理",
      webLink: String(message.webLink || message.web_link || ""),
      bodyPreview: String(message.bodyPreview || "").slice(0, 4000),
      bodyText: messageBodyText(message),
      financial: message.financial && typeof message.financial === "object"
        ? message.financial
        : undefined,
    }));
    const tasks = dayMessages.map((message) => taskFor(message, today)).filter(Boolean);
    const order = ["P0", "P1", "P2", "P3"];
    const highestPriority = items.length
      ? order.find((priority) => items.some((item) => item.priority === priority))
      : "-";
    return {
      briefDate,
      source: "Outlook Email · full daily connector sync",
      summary: {
        total: items.length,
        unread: items.filter((item) => item.unread).length,
        actionRequired: tasks.length,
        highestPriority,
      },
      items,
      tasks,
      sections: sectionsFor(items, tasks),
    };
  });
}

async function jsonRequest(fetchImpl, url, init, label) {
  const response = await fetchImpl(url, init);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${label}响应不是有效 JSON（HTTP ${response.status}）`);
  }
  if (!response.ok || body?.error) {
    const detail = body?.error?.message || body?.error_description || body?.error || "未知错误";
    throw new Error(`${label}失败（HTTP ${response.status}）：${detail}`);
  }
  return body;
}

async function graphAccess(env, fetchImpl) {
  const tenant = env.MICROSOFT_TENANT_ID || "organizations";
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new Error("Microsoft Graph OAuth 凭证未配置");
  }
  const form = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    client_secret: env.MICROSOFT_CLIENT_SECRET,
  });
  let mailboxPath;
  if (env.MICROSOFT_REFRESH_TOKEN) {
    form.set("grant_type", "refresh_token");
    form.set("refresh_token", env.MICROSOFT_REFRESH_TOKEN);
    form.set("scope", "offline_access Mail.Read User.Read");
    mailboxPath = "/me";
  } else {
    if (!env.OUTLOOK_MAILBOX_USER) throw new Error("OUTLOOK_MAILBOX_USER 未配置");
    form.set("grant_type", "client_credentials");
    form.set("scope", "https://graph.microsoft.com/.default");
    mailboxPath = `/users/${encodeURIComponent(env.OUTLOOK_MAILBOX_USER)}`;
  }
  const token = await jsonRequest(
    fetchImpl,
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    },
    "Microsoft Graph OAuth",
  );
  if (!token.access_token) throw new Error("Microsoft Graph OAuth 缺少 access_token");
  return { accessToken: token.access_token, mailboxPath };
}

async function graphPages(fetchImpl, initialUrl, accessToken, label) {
  const values = [];
  let url = initialUrl;
  while (url) {
    const page = await jsonRequest(
      fetchImpl,
      url,
      { headers: { authorization: `Bearer ${accessToken}` } },
      label,
    );
    values.push(...(page.value || []));
    url = page["@odata.nextLink"] || "";
  }
  return values;
}

async function listFolders(fetchImpl, mailboxPath, accessToken) {
  const folders = await graphPages(
    fetchImpl,
    `${GRAPH_ROOT}${mailboxPath}/mailFolders?$top=200&includeHiddenFolders=false`,
    accessToken,
    "Outlook 文件夹读取",
  );
  const queue = folders.filter((folder) => Number(folder.childFolderCount || 0) > 0);
  for (const parent of queue) {
    const children = await graphPages(
      fetchImpl,
      `${GRAPH_ROOT}${mailboxPath}/mailFolders/${encodeURIComponent(parent.id)}/childFolders?$top=200&includeHiddenFolders=false`,
      accessToken,
      "Outlook 子文件夹读取",
    );
    folders.push(...children);
    queue.push(...children.filter((folder) => Number(folder.childFolderCount || 0) > 0));
  }
  return folders;
}

async function listRecentMessages(fetchImpl, mailboxPath, folders, accessToken, cutoff) {
  const messages = [];
  for (const folder of folders) {
    const initial = new URL(
      `${GRAPH_ROOT}${mailboxPath}/mailFolders/${encodeURIComponent(folder.id)}/messages`,
    );
    initial.searchParams.set(
      "$select",
      "id,subject,bodyPreview,body,webLink,from,receivedDateTime,isRead,importance,hasAttachments",
    );
    initial.searchParams.set("$filter", `receivedDateTime ge ${new Date(cutoff).toISOString()}`);
    initial.searchParams.set("$orderby", "receivedDateTime desc");
    initial.searchParams.set("$top", "100");
    let url = initial.toString();
    while (url) {
      const page = await jsonRequest(
        fetchImpl,
        url,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
            prefer: 'outlook.body-content-type="text"',
          },
        },
        `Outlook 邮件读取（${folder.displayName || folder.id}）`,
      );
      const rows = page.value || [];
      messages.push(...rows.filter((message) => Date.parse(message.receivedDateTime) >= cutoff));
      if (rows.some((message) => Date.parse(message.receivedDateTime) < cutoff)) break;
      url = page["@odata.nextLink"] || "";
    }
  }
  return messages;
}

async function addAttachmentMetadata(fetchImpl, mailboxPath, messages, accessToken) {
  for (const message of messages.filter((item) => item.hasAttachments && isWayfairMessage(item))) {
    const attachments = await jsonRequest(
      fetchImpl,
      `${GRAPH_ROOT}${mailboxPath}/messages/${encodeURIComponent(message.id)}/attachments?$select=id,name,contentType,size,isInline&$top=100`,
      { headers: { authorization: `Bearer ${accessToken}` } },
      "Outlook 附件元数据读取",
    );
    message.attachmentNames = (attachments.value || [])
      .filter((attachment) => !attachment.isInline && attachment.name)
      .map((attachment) => String(attachment.name).slice(0, 160))
      .slice(0, 20);
    const remittance = (attachments.value || []).find((attachment) => (
      !attachment.isInline
      && Number(attachment.size || 0) > 0
      && Number(attachment.size || 0) <= MAX_REMITTANCE_ATTACHMENT_BYTES
      && /(?:wayfair[_ -])?remittance.*\.csv$/i.test(String(attachment.name || ""))
    ));
    if (remittance?.id) {
      const response = await fetchImpl(
        `${GRAPH_ROOT}${mailboxPath}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(remittance.id)}/$value`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) {
        throw new Error(`Outlook 汇款附件读取失败（HTTP ${response.status}）`);
      }
      const content = new TextDecoder().decode(await response.arrayBuffer());
      const financial = parseWayfairRemittanceCsv(content);
      if (financial) message.financial = financial;
    }
  }
}

export async function syncOutlookDaily({
  env,
  db,
  fetchImpl = fetch,
  now = new Date(),
}) {
  const today = lingxingDate(now);
  const cutoff = Date.parse(lingxingDayStart(addDays(today, -2)));
  const { accessToken, mailboxPath } = await graphAccess(env, fetchImpl);
  const folders = selectTargetMailFolders(
    await listFolders(fetchImpl, mailboxPath, accessToken),
  );
  if (!folders.length) throw new Error("未找到 Outlook 收件箱或 Wayfair 文件夹");
  const messages = await listRecentMessages(
    fetchImpl,
    mailboxPath,
    folders,
    accessToken,
    cutoff,
  );
  await addAttachmentMetadata(fetchImpl, mailboxPath, messages, accessToken);
  const reports = buildDailyReports(messages, today);
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS outlook_daily_briefs (brief_date TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, synced_at TEXT NOT NULL)",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  const syncedAt = now.toISOString();
  const statements = reports.map((report) => db.prepare(
    "INSERT INTO outlook_daily_briefs(brief_date,payload,synced_at) VALUES(?,?,?) ON CONFLICT(brief_date) DO UPDATE SET payload=excluded.payload,synced_at=excluded.synced_at",
  ).bind(report.briefDate, JSON.stringify(report), syncedAt));
  statements.push(db.prepare(
    "INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
  ).bind(
    "outlook:daily:last-run",
    JSON.stringify({ folders: folders.map((folder) => folder.displayName), messages: messages.length }),
    syncedAt,
  ));
  await db.batch(statements);
  return {
    ok: true,
    syncedAt,
    folders: folders.map((folder) => folder.displayName),
    reports: reports.map((report) => ({
      briefDate: report.briefDate,
      total: report.summary.total,
      highestPriority: report.summary.highestPriority,
    })),
  };
}
