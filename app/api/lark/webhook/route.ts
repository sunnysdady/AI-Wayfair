import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";
import { handleLarkWebhook } from "@/lib/lark-bot.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function larkHeaders(request: Request) {
  const result: Record<string, string> = {};
  for (const name of [
    "x-lark-signature",
    "x-lark-request-timestamp",
    "x-lark-request-nonce",
  ]) {
    const value = request.headers.get(name);
    if (value) result[name] = value;
  }
  return result;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const env = await getRuntimeBindings();
  return handleLarkWebhook(rawBody, env, {
    headers: larkHeaders(request),
    waitUntil: (promise: Promise<unknown>) => {
      // 长驻 Node 服务中，响应返回后继续执行异步 AI 回复任务。
      void promise;
    },
  });
}
