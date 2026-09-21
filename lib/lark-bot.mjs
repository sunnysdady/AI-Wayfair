import crypto from "node:crypto";
import { answerAssistantChat } from "./assistant-chat.mjs";

const LARK_OPEN_URL = "https://open.feishu.cn";
const TOKEN_TTL_MARGIN_MS = 60_000;
const MAX_TEXT_LENGTH = 8_000;
const MAX_EVENT_IDS = 1_000;

const processedEventIds = new Set();

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function larkSha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function verifyLarkSignature(encryptKey, timestamp, nonce, rawBody, signature) {
  const expected = larkSha256Hex(`${timestamp}${nonce}${encryptKey}${rawBody}`);
  return expected === signature;
}

function decodeAesKey(encryptKey) {
  return crypto.createHash("sha256").update(encryptKey, "utf8").digest();
}

function unpadPkcs7(buffer) {
  const padding = buffer[buffer.length - 1];
  if (!padding || padding > 16) return buffer;
  for (let index = buffer.length - padding; index < buffer.length; index += 1) {
    if (buffer[index] !== padding) return buffer;
  }
  return buffer.subarray(0, buffer.length - padding);
}

export function larkAesDecrypt(encryptKey, encryptedBase64) {
  const payload = Buffer.from(encryptedBase64, "base64");
  if (payload.length <= 16) {
    throw new Error("加密回调内容过短");
  }
  const iv = payload.subarray(0, 16);
  const encrypted = payload.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", decodeAesKey(encryptKey), iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return unpadPkcs7(decrypted).toString("utf8");
}

export function larkAesEncrypt(encryptKey, plainText) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", decodeAesKey(encryptKey), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString("base64");
}

function markEventSeen(eventId) {
  if (processedEventIds.has(eventId)) return false;
  processedEventIds.add(eventId);
  if (processedEventIds.size > MAX_EVENT_IDS) {
    const [oldest] = processedEventIds;
    if (oldest !== undefined) processedEventIds.delete(oldest);
  }
  return true;
}

let cachedTenantToken = null;

export async function getTenantAccessToken(env, options = {}) {
  const appId = String(env.LARK_APP_ID || "").trim();
  const appSecret = String(env.LARK_APP_SECRET || "").trim();
  if (!appId || !appSecret) {
    throw new Error("未配置 LARK_APP_ID / LARK_APP_SECRET");
  }
  const now = Date.now();
  if (cachedTenantToken && cachedTenantToken.expiresAt > now + TOKEN_TTL_MARGIN_MS) {
    return cachedTenantToken.token;
  }
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${LARK_OPEN_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const payload = await response.json();
  if (Number(payload.code) !== 0 || !payload.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败: ${payload.code} ${payload.msg || ""}`);
  }
  const expiresInMs = Number(payload.expire || 7_200) * 1_000;
  cachedTenantToken = { token: payload.tenant_access_token, expiresAt: now + expiresInMs };
  return cachedTenantToken.token;
}

export async function getLarkBotInfo(env, options = {}) {
  const token = await getTenantAccessToken(env, options);
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${LARK_OPEN_URL}/open-apis/bot/v3/info`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  if (Number(payload.code) !== 0 || !payload.bot) {
    throw new Error(`获取机器人信息失败: ${payload.code} ${payload.msg || ""}`);
  }
  return payload.bot;
}

async function sendTextMessage(env, endpoint, body, options) {
  const token = await getTenantAccessToken(env, options);
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${LARK_OPEN_URL}${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (Number(payload.code) !== 0) {
    throw new Error(`发送飞书消息失败: ${payload.code} ${payload.msg || ""}`);
  }
  return payload;
}

export async function sendLarkChatText(env, chatId, text, options = {}) {
  const content = JSON.stringify({ text: String(text).slice(0, MAX_TEXT_LENGTH) });
  return sendTextMessage(env, `/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    receive_id: chatId,
    msg_type: "text",
    content,
  }, options);
}

export async function replyLarkMessageText(env, messageId, text, options = {}) {
  const content = JSON.stringify({ text: String(text).slice(0, MAX_TEXT_LENGTH) });
  return sendTextMessage(env, `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
    msg_type: "text",
    content,
  }, options);
}

function parseTextContent(rawContent) {
  try {
    const parsed = JSON.parse(rawContent);
    return typeof parsed.text === "string" ? parsed.text : null;
  } catch {
    return null;
  }
}

function stripMentionTags(text) {
  return String(text)
    .replace(/<at[^>]*>.*?<\/at>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseLarkMessageEvent(event) {
  const message = event?.message;
  if (!message || typeof message !== "object") return null;
  if (message.message_type !== "text") return null;

  const text = parseTextContent(message.content);
  if (!text || !text.trim()) return null;

  const mentions = Array.isArray(message.mentions)
    ? message.mentions.map((item) => item?.id?.open_id || item?.id?.user_id || item?.id?.union_id || null).filter(Boolean)
    : [];

  return {
    messageId: String(message.message_id || ""),
    chatId: String(message.chat_id || ""),
    chatType: message.chat_type === "group" ? "group" : "p2p",
    senderType: event?.sender?.sender_type || "user",
    text: text.trim(),
    cleanText: stripMentionTags(text),
    mentions,
  };
}

export function isMentionedByBot(parsed, botOpenId) {
  if (!parsed.mentions.length) return false;
  if (botOpenId && parsed.mentions.includes(botOpenId)) return true;
  return parsed.mentions.some((id) => String(id).startsWith("cli_"));
}

async function answerAndReply(env, parsed, options) {
  let botOpenId = null;
  if (parsed.chatType === "group") {
    try {
      const bot = await getLarkBotInfo(env, options);
      botOpenId = bot.open_id || null;
    } catch {
      // Fall back to cli_ prefix matching when bot info is unavailable.
    }
    if (!isMentionedByBot(parsed, botOpenId)) {
      return null;
    }
  }

  const result = await answerAssistantChat(env.DB, { message: parsed.cleanText, history: [] }, {
    processEnv: env,
    fetchImpl: options.fetchImpl,
  });
  const reply = String(result.message || "").trim();
  if (!reply) return null;

  if (parsed.chatType === "group" && parsed.messageId) {
    await replyLarkMessageText(env, parsed.messageId, reply, options);
  } else {
    await sendLarkChatText(env, parsed.chatId, reply, options);
  }
  return { messageId: parsed.messageId, chatId: parsed.chatId };
}

export async function handleLarkWebhook(rawBody, env, options = {}) {
  const headers = options.headers || {};
  const encryptKey = String(env.LARK_ENCRYPT_KEY || "").trim();
  const verificationToken = String(env.LARK_VERIFICATION_TOKEN || "").trim();

  // 签名校验：事件推送请求会带签名头；URL 有效性校验请求不带签名头，此时跳过校验。
  if (encryptKey) {
    const signature = headers["x-lark-signature"];
    const timestamp = headers["x-lark-request-timestamp"];
    const nonce = headers["x-lark-request-nonce"];
    if (signature || timestamp || nonce) {
      if (!signature || !timestamp || !nonce) {
        return jsonResponse({ error: "缺少签名头" }, 401);
      }
      if (!verifyLarkSignature(encryptKey, timestamp, nonce, rawBody, signature)) {
        return jsonResponse({ error: "签名校验失败" }, 401);
      }
    }
  }

  // URL 有效性校验：即使配置了加密，飞书也以明文发送该请求，需优先识别。
  try {
    const plain = JSON.parse(rawBody);
    if (plain && plain.type === "url_verification") {
      if (verificationToken && plain.token !== verificationToken) {
        return jsonResponse({ error: "校验 Token 不匹配" }, 401);
      }
      return jsonResponse({ challenge: plain.challenge });
    }
  } catch {
    // 非明文 JSON（如加密事件），继续按既有流程解密处理。
  }

  let payload;
  if (encryptKey) {
    try {
      const encrypted = JSON.parse(rawBody)?.encrypt;
      if (typeof encrypted !== "string") {
        return jsonResponse({ error: "缺少加密内容" }, 400);
      }
      payload = JSON.parse(larkAesDecrypt(encryptKey, encrypted));
    } catch {
      return jsonResponse({ error: "回调解密失败" }, 400);
    }
  } else {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "回调内容不是有效 JSON" }, 400);
    }
  }

  // URL 有效性校验：原样返回 challenge。
  if (payload.type === "url_verification") {
    if (verificationToken && payload.token !== verificationToken) {
      return jsonResponse({ error: "校验 Token 不匹配" }, 401);
    }
    return jsonResponse({ challenge: payload.challenge });
  }

  // 非校验事件：校验 Verification Token（未加密场景）。
  if (!encryptKey && verificationToken) {
    const eventToken = payload.header?.token || payload.token;
    if (eventToken !== verificationToken) {
      return jsonResponse({ error: "校验 Token 不匹配" }, 401);
    }
  }

  const eventType = payload.header?.event_type || payload.type;
  const eventId = payload.header?.event_id || payload.uuid;
  if (eventType !== "im.message.receive_v1") {
    return jsonResponse({});
  }
  if (eventId) {
    if (!markEventSeen(eventId)) {
      return jsonResponse({});
    }
  }

  const parsed = parseLarkMessageEvent(payload.event);
  if (!parsed || parsed.senderType === "app") {
    return jsonResponse({});
  }

  // 飞书要求 3 秒内返回 200；AI 分析放到请求之后异步执行。
  const task = answerAndReply(env, parsed, options).catch(() => undefined);
  if (typeof options.waitUntil === "function") {
    options.waitUntil(task);
  }
  return jsonResponse({});
}
