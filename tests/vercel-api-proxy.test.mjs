import assert from "node:assert/strict";
import test from "node:test";

import { proxySitesApi } from "../lib/sites-api-proxy.mjs";

const validEnv = {
  SITES_API_ORIGIN: "https://wayfair-ai-ops-center.sunnysdady.chatgpt.site",
  SITES_BYPASS_TOKEN: "test-secret-token",
};

test("fails closed when the Vercel Sites bridge is not configured", async () => {
  let called = false;
  const response = await proxySitesApi(
    new Request("https://ai-wayfair.vercel.app/api/email/daily"),
    {},
    async () => {
      called = true;
      return new Response();
    },
  );

  assert.equal(response.status, 503);
  assert.equal(called, false);
  assert.deepEqual(await response.json(), {
    error: "Vercel 数据服务尚未配置，请使用 Sites 版本或联系管理员。",
  });
});

test("rejects an untrusted upstream before attaching the private token", async () => {
  let called = false;
  const response = await proxySitesApi(
    new Request("https://ai-wayfair.vercel.app/api/orders/summary"),
    { ...validEnv, SITES_API_ORIGIN: "https://attacker.example" },
    async () => {
      called = true;
      return new Response();
    },
  );

  assert.equal(response.status, 503);
  assert.equal(called, false);
  assert.doesNotMatch(await response.text(), /test-secret-token|attacker\.example/);
});

test("forwards API method, query and body without leaking visitor credentials", async () => {
  let forwarded;
  const response = await proxySitesApi(
    new Request("https://ai-wayfair.vercel.app/api/email/daily?date=2026-07-22", {
      method: "POST",
      headers: {
        authorization: "Bearer visitor-token",
        cookie: "session=visitor-cookie",
        "content-type": "application/json",
        "oai-sites-authorization": "Bearer attacker-token",
        "x-request-id": "request-123",
      },
      body: JSON.stringify({ refresh: true }),
    }),
    validEnv,
    async (url, init) => {
      forwarded = { url: String(url), init };
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: {
          "content-type": "application/json",
          "set-cookie": "sites-session=private",
          "x-upstream": "sites",
        },
      });
    },
  );

  assert.equal(forwarded.url, "https://wayfair-ai-ops-center.sunnysdady.chatgpt.site/api/email/daily?date=2026-07-22");
  assert.equal(forwarded.init.method, "POST");
  assert.equal(new TextDecoder().decode(forwarded.init.body), JSON.stringify({ refresh: true }));
  assert.equal(forwarded.init.headers.get("oai-sites-authorization"), "Bearer test-secret-token");
  assert.equal(forwarded.init.headers.get("authorization"), null);
  assert.equal(forwarded.init.headers.get("cookie"), null);
  assert.equal(forwarded.init.headers.get("host"), null);
  assert.equal(forwarded.init.headers.get("x-request-id"), "request-123");
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-upstream"), "sites");
});

test("refuses to proxy paths outside the API namespace", async () => {
  let called = false;
  const response = await proxySitesApi(
    new Request("https://ai-wayfair.vercel.app/dashboard"),
    validEnv,
    async () => {
      called = true;
      return new Response();
    },
  );

  assert.equal(response.status, 404);
  assert.equal(called, false);
});
