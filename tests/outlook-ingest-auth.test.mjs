import assert from "node:assert/strict";
import test from "node:test";

import { hasOutlookIngestAuthorization } from "../lib/outlook-ingest-auth.mjs";

test("accepts the dedicated Outlook ingest token", () => {
  const headers = new Headers({ authorization: "Bearer ingest-secret" });
  assert.equal(hasOutlookIngestAuthorization(headers, "ingest-secret"), true);
});

test("does not trust legacy proxy headers on the standalone service", () => {
  const headers = new Headers({
    "oai-authenticated-user-email": "owner@example.com",
    "sec-fetch-site": "same-origin",
  });
  assert.equal(hasOutlookIngestAuthorization(headers, "ingest-secret"), false);
});

test("rejects forged, cross-origin, and unauthenticated requests", () => {
  assert.equal(hasOutlookIngestAuthorization(new Headers({ "oai-authenticated-user-email": "attacker@example.com" }), "ingest-secret"), false);
  assert.equal(hasOutlookIngestAuthorization(new Headers({ "sec-fetch-site": "same-origin" }), "ingest-secret"), false);
  assert.equal(hasOutlookIngestAuthorization(new Headers({ authorization: "Bearer wrong" }), "ingest-secret"), false);
});
