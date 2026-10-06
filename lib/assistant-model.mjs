// OpenAI 兼容 Responses API 的共用小工具：对话回答与意图规划共用同一套服务端配置。

export function modelConfiguration(env) {
  const baseUrl = String(env.AI_MODEL_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiKey = String(env.AI_MODEL_API_KEY || "").trim();
  const model = String(env.AI_MODEL_NAME || "").trim();
  if (!baseUrl || !apiKey || !model) {
    return null;
  }
  try {
    const url = new URL(baseUrl);
    return url.protocol === "https:" ? { baseUrl, apiKey, model } : null;
  } catch {
    return null;
  }
}

export function responseInput(messages) {
  return messages.map(({ role, content }) => ({
    role,
    content: [{ type: role === "assistant" ? "output_text" : "input_text", text: content }],
  }));
}

export function responseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const text = (payload?.output || [])
    .filter((item) => item?.type === "message")
    .flatMap((item) => item.content || [])
    .filter((item) => item?.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n");
  return text || null;
}
