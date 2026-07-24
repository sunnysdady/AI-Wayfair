export function hasOutlookIngestAuthorization(headers, token) {
  const authorization = headers.get("authorization");
  return Boolean(token) && authorization === `Bearer ${token}`;
}
