import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchAdvertisingResponse,
  isRetryableAdvertisingStatus,
} from "../lib/wayfair-ad-retry.mjs";

test("retries transient advertising responses with bounded backoff", async () => {
  const statuses = [500, 429, 200];
  const delays = [];
  const response = await fetchAdvertisingResponse(
    "https://api.example.test/reports",
    { method: "POST" },
    {
      fetchImpl: async () => new Response("{}", {
        status: statuses.shift(),
      }),
      wait: async (milliseconds) => {
        delays.push(milliseconds);
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(delays, [500, 1_000]);
});

test("does not retry permanent advertising errors", async () => {
  let calls = 0;
  const response = await fetchAdvertisingResponse(
    "https://api.example.test/reports",
    {},
    {
      fetchImpl: async () => {
        calls += 1;
        return new Response("{}", { status: 400 });
      },
      wait: async () => {
        throw new Error("permanent failures must not wait");
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(calls, 1);
  assert.equal(isRetryableAdvertisingStatus(401), true);
  assert.equal(isRetryableAdvertisingStatus(429), true);
  assert.equal(isRetryableAdvertisingStatus(503), true);
  assert.equal(isRetryableAdvertisingStatus(400), false);
});
