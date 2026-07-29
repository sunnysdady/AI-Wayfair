import assert from "node:assert/strict";
import test from "node:test";
import { sameOrigin } from "../lib/http-origin.mjs";

test("sameOrigin trusts forwarded production origin behind proxy", () => {
  const request = new Request("http://127.0.0.1:3000/api/ads/manual-completions", {
    headers: {
      origin: "https://aiwayfair.sunnysdady.com",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "aiwayfair.sunnysdady.com",
    },
  });

  assert.equal(sameOrigin(request), true);
});

test("sameOrigin rejects hostile origins", () => {
  const request = new Request("http://127.0.0.1:3000/api/ads/manual-completions", {
    headers: {
      origin: "https://example.com",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "aiwayfair.sunnysdady.com",
    },
  });

  assert.equal(sameOrigin(request), false);
});

test("sameOrigin allows requests without browser origin", () => {
  const request = new Request("http://127.0.0.1:3000/api/ads/manual-completions");

  assert.equal(sameOrigin(request), true);
});
