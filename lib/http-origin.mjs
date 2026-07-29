export function requestOrigin(request) {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === requestOrigin(request);
}
