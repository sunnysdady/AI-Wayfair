import assert from "node:assert/strict";
import test from "node:test";

import { proxySitesApi } from "../lib/sites-api-proxy.mjs";

const validEnv = {
  SITES_API_ORIGIN: "https://wayfair-ai-ops-center.sunnysdady.chatgpt.site",
  SITES_BYPASS_TOKEN: "test-secret-token",
  OUTLOOK_INGEST_TOKEN: "test-ingest-token",
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

test("converts an expired Sites credential response into a JSON gateway error", async () => {
  const response = await proxySitesApi(
    new Request("https://ai-wayfair.vercel.app/api/ads/analysis?start=2026-07-10&end=2026-07-23"),
    validEnv,
    async () => new Response("<!doctype html><title>Sign in</title>", {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );

  assert.equal(response.status, 502);
  assert.match(response.headers.get("content-type") || "", /^application\/json/);
  assert.deepEqual(await response.json(), {
    error: "Sites 数据服务授权已失效，请更新服务端连接凭证。",
  });
});

test("forwards API method and query without leaking visitor credentials", async () => {
  let forwarded;
  const response = await proxySitesApi(
    new Request("https://ai-wayfair.vercel.app/api/email/daily?date=2026-07-22", {
      method: "GET",
      headers: {
        authorization: "Bearer visitor-token",
        cookie: "session=visitor-cookie",
        "content-type": "application/json",
        "oai-sites-authorization": "Bearer attacker-token",
        "oai-authenticated-user-email": "attacker@example.com",
        "x-request-id": "request-123",
        "x-wayfair-automation": "outlook-daily-sync",
      },
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
  assert.equal(forwarded.init.method, "GET");
  assert.equal(forwarded.init.body, undefined);
  assert.equal(forwarded.init.headers.get("oai-sites-authorization"), "Bearer test-secret-token");
  assert.equal(forwarded.init.headers.get("authorization"), null);
  assert.equal(forwarded.init.headers.get("cookie"), null);
  assert.equal(forwarded.init.headers.get("host"), null);
  assert.equal(forwarded.init.headers.get("x-wayfair-automation"), null);
  assert.equal(forwarded.init.headers.get("oai-authenticated-user-email"), null);
  assert.equal(forwarded.init.headers.get("x-request-id"), "request-123");
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-upstream"), "sites");
});

test("rejects Outlook ingest before dispatch when the dedicated token is missing or invalid", async () => {
  let called = false;
  const response = await proxySitesApi(
    new Request("https://ai-wayfair.vercel.app/api/email/daily", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
      body: JSON.stringify({ briefDate: "2026-07-22" }),
    }),
    validEnv,
    async () => {
      called = true;
      return new Response();
    },
  );

  assert.equal(response.status, 401);
  assert.equal(called, false);
  assert.deepEqual(await response.json(), { error: "Outlook 同步凭证无效" });
});

test("uses separate gateway and ingest credentials for authorized Outlook writes", async () => {
  let forwarded;
  const payload = JSON.stringify({ briefDate: "2026-07-22" });
  const response = await proxySitesApi(
    new Request("https://ai-wayfair.vercel.app/api/email/daily", {
      method: "POST",
      headers: {
        authorization: "Bearer test-ingest-token",
        "content-type": "application/json",
        "oai-sites-authorization": "Bearer attacker-token",
        "x-wayfair-automation": "outlook-daily-sync",
      },
      body: payload,
    }),
    validEnv,
    async (url, init) => {
      forwarded = { url: String(url), init };
      return Response.json({ ok: true }, { status: 201 });
    },
  );

  assert.equal(forwarded.url, "https://wayfair-ai-ops-center.sunnysdady.chatgpt.site/api/email/daily");
  assert.equal(forwarded.init.headers.get("oai-sites-authorization"), "Bearer test-secret-token");
  assert.equal(forwarded.init.headers.get("authorization"), "Bearer test-ingest-token");
  assert.equal(forwarded.init.headers.get("x-wayfair-automation"), null);
  assert.equal(new TextDecoder().decode(forwarded.init.body), payload);
  assert.equal(response.status, 201);
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
