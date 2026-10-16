import { sameOrigin } from "./http-origin.mjs";

/**
 * `refresh=1` on a GET triggers outbound Wayfair calls, so a cross-site page must not
 * be able to fire it (e.g. via <img>/navigation, which carry no Origin header).
 * Browsers always send Sec-Fetch-Site: only same-origin or user-typed ("none") pass.
 * Requests without it (the internal 06:00 sync, curl) are allowed, as before.
 */
export function refreshAllowed(request) {
  if (!sameOrigin(request)) return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}
