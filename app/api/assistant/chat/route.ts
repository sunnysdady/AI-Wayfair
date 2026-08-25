import {
  AssistantChatInputError,
  answerAssistantChat,
} from "@/lib/assistant-chat.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_REQUESTS_PER_MINUTE = 12;
const RATE_LIMIT_WINDOW_MS = 60_000;
const requestWindows = new Map<string, { count: number; startedAt: number }>();

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
    || url.protocol.slice(0, -1);
  return origin === `${protocol}://${host}`;
}

function isRateLimited(request: Request) {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const current = requestWindows.get(key);

  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    requestWindows.set(key, { count: 1, startedAt: now });
    return false;
  }
  if (current.count >= MAX_REQUESTS_PER_MINUTE) {
    return true;
  }
  current.count += 1;
  return false;
}

async function readJsonBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    throw new AssistantChatInputError("请求内容过大");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new AssistantChatInputError("请求内容过大");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AssistantChatInputError("请求体必须是有效 JSON");
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "请求来源无效" }, { status: 403 });
  }
  if (isRateLimited(request)) {
    return Response.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }
  try {
    const input = await readJsonBody(request);
    const env = await getRuntimeBindings();
    const result = await answerAssistantChat(env.DB, input);
    return Response.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AssistantChatInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: "AI 助理暂时无法处理该问题" }, { status: 500 });
  }
}
