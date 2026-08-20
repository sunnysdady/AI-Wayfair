#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [snapshotFile] = process.argv.slice(2);
const origin = String(process.env.AIWAYFAIR_ORIGIN || "").replace(/\/$/, "");
const secret = process.env.AIWAYFAIR_CRON_SECRET;
if (!snapshotFile || !origin || !secret) {
  console.error("Usage: AIWAYFAIR_ORIGIN=https://aiwayfair.sunnysdady.com AIWAYFAIR_CRON_SECRET=… node scripts/ingest-product-management-snapshot.mjs <snapshot.json>");
  process.exit(2);
}
const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
const response = await fetch(`${origin}/api/internal/product-management/ingest`, {
  method: "POST",
  headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
  body: JSON.stringify({ snapshot }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok || body.status !== "succeeded") {
  console.error(`Product Management ingest failed (HTTP ${response.status}): ${body.error || "unknown error"}`);
  process.exit(1);
}
console.log(JSON.stringify({ status: body.status, runId: body.runId, audit: body.audit }));
