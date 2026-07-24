export function hasOutlookIngestAuthorization(headers, token) {
  const authorization = headers.get("authorization");
  if (token && authorization === `Bearer ${token}`) return true;

  const authenticatedEmail = headers.get("oai-authenticated-user-email");
  return Boolean(authenticatedEmail) && headers.get("sec-fetch-site") === "same-origin";
}
