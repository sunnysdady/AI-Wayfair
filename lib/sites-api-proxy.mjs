const UNAVAILABLE_MESSAGE = "Vercel 数据服务尚未配置，请使用 Sites 版本或联系管理员。";
const BAD_GATEWAY_MESSAGE = "数据服务暂时不可用，请稍后重试。";

function jsonError(message, status) {
  return Response.json({ error: message }, { status });
}

function trustedSitesOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const isSitesHost = url.hostname.endsWith(".chatgpt.site");
    const isBareOrigin = url.pathname === "/" && !url.search && !url.hash;
    if (url.protocol !== "https:" || !isSitesHost || !isBareOrigin || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function upstreamHeaders(requestHeaders, token) {
  const headers = new Headers(requestHeaders);
  for (const name of [
    "authorization",
    "connection",
    "content-length",
    "cookie",
    "host",
    "oai-sites-authorization",
    "proxy-authorization",
    "transfer-encoding",
    "x-wayfair-automation",
  ]) headers.delete(name);
  for (const name of [...headers.keys()]) {
    if (name.startsWith("oai-authenticated-")) headers.delete(name);
  }
  headers.set("oai-sites-authorization", `Bearer ${token}`);
  return headers;
}

function validIngestAuthorization(requestHeaders, token) {
  if (!token) return false;
  return requestHeaders.get("authorization") === `Bearer ${token}`;
}

function downstreamHeaders(upstream) {
  const headers = new Headers(upstream);
  for (const name of ["content-encoding", "content-length", "set-cookie", "transfer-encoding"]) headers.delete(name);
  return headers;
}

export async function proxySitesApi(request, env = process.env, fetchImpl = fetch) {
  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith("/api/")) return jsonError("Not found", 404);

  const origin = trustedSitesOrigin(env.SITES_API_ORIGIN);
  const token = env.SITES_BYPASS_TOKEN;
  if (!origin || !token) return jsonError(UNAVAILABLE_MESSAGE, 503);

  const upstream = new URL(`${incoming.pathname}${incoming.search}`, origin);
  const method = request.method.toUpperCase();
  const isOutlookIngest = method === "POST" && incoming.pathname === "/api/email/daily";
  const ingestToken = env.OUTLOOK_INGEST_TOKEN;
  if (isOutlookIngest && !validIngestAuthorization(request.headers, ingestToken)) {
    return jsonError("Outlook 同步凭证无效", 401);
  }

  const headers = upstreamHeaders(request.headers, token);
  if (isOutlookIngest) headers.set("authorization", `Bearer ${ingestToken}`);
  const body = method === "GET" || method === "HEAD" || !request.body
    ? undefined
    : new Uint8Array(await request.arrayBuffer());

  try {
    const response = await fetchImpl(upstream, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: request.signal,
    });
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: downstreamHeaders(response.headers),
    });
  } catch (error) {
    console.error("[vercel-sites-proxy] upstream request failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown failure",
    });
    return jsonError(BAD_GATEWAY_MESSAGE, 502);
  }
}
