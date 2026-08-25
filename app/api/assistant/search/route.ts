import {
  AssistantSearchInputError,
  searchAssistantKnowledge,
} from "@/lib/assistant-search.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4 * 1024;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host") || url.host;
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProtocol?.split(",")[0]?.trim() || url.protocol.slice(0, -1);

  return origin === `${protocol}://${host}`;
}

async function readJsonBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    throw new AssistantSearchInputError("请求内容过大");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new AssistantSearchInputError("请求内容过大");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AssistantSearchInputError("请求体必须是有效 JSON");
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "请求来源无效" }, { status: 403 });
  }
  try {
    const input = await readJsonBody(request);
    const env = await getRuntimeBindings();
    const result = await searchAssistantKnowledge(env.DB, input);
    return Response.json(result, {
      headers: { "cache-control": "private, max-age=60" },
    });
  } catch (error) {
    if (error instanceof AssistantSearchInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: "数据助理暂时无法读取已保存的数据" }, { status: 500 });
  }
}
