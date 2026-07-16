import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the Wayfair AI operations product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Wayfair AI 运营中台/);
  assert.match(html, /经营日报/);
  assert.match(html, /最近 7 天/);
  assert.match(html, /估算利润/);
  assert.match(html, /广告优化/);
  assert.match(html, /Ops API（库存 \+ 订单）/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
