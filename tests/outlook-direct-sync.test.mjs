import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildDailyReports,
  selectTargetMailFolders,
} from "../lib/outlook-daily-sync.mjs";

test("selects Inbox and every custom Wayfair folder", () => {
  const folders = [
    { id: "inbox", displayName: "Inbox", wellKnownName: "inbox" },
    { id: "orders", displayName: "wayfair 订单" },
    { id: "billing", displayName: "Wayfair Billing" },
    { id: "archive", displayName: "Archive" },
  ];

  assert.deepEqual(
    selectTargetMailFolders(folders).map((folder) => folder.id),
    ["inbox", "orders", "billing"],
  );
});

test("builds three Shanghai daily reports from all Wayfair operating categories", () => {
  const messages = [
    {
      id: "po",
      subject: "Action Required: PO# CS123",
      sender: { emailAddress: { address: "NewSupplierOps@wayfair.com" } },
      receivedDateTime: "2026-07-24T02:00:00Z",
      isRead: false,
      bodyPreview: "Register and Fulfill PO -- Must Ship By 07/24/2026",
      webLink: "https://outlook.example/po",
    },
    {
      id: "finance",
      subject: "Payment Remittance - #10001",
      sender: { emailAddress: { address: "noreply@wayfair.com" } },
      receivedDateTime: "2026-07-23T15:00:00Z",
      isRead: true,
      bodyPreview: "Payment remittance attached",
      webLink: "https://outlook.example/finance",
    },
    {
      id: "opportunity",
      subject: "Reduce Your Lost Sales Opportunities",
      sender: { emailAddress: { address: "growth@wayfair.com" } },
      receivedDateTime: "2026-07-22T03:00:00Z",
      isRead: true,
      bodyPreview: "Check your future inventory gap report",
      webLink: "https://outlook.example/opportunity",
    },
    {
      id: "noise",
      subject: "Unrelated newsletter",
      sender: { emailAddress: { address: "news@example.com" } },
      receivedDateTime: "2026-07-24T03:00:00Z",
      isRead: false,
      bodyPreview: "Not Wayfair",
      webLink: "https://outlook.example/noise",
    },
  ];

  const reports = buildDailyReports(messages, "2026-07-24");

  assert.deepEqual(reports.map((report) => report.briefDate), [
    "2026-07-24",
    "2026-07-23",
    "2026-07-22",
  ]);
  assert.deepEqual(reports.map((report) => report.summary.total), [1, 1, 1]);
  assert.equal(reports[0].summary.highestPriority, "P1");
  assert.equal(reports[0].items[0].category, "订单履约");
  assert.equal(reports[1].items[0].category, "账单/回款");
  assert.equal(reports[2].items[0].category, "活动/广告机会");
  assert.ok(reports[0].sections.some((section) => section.title === "最高风险"));
  assert.ok(reports.every((report) => (
    report.source === "Outlook Email · full daily connector sync"
  )));
});

test("bounds Graph pagination with a server-side received date filter", async () => {
  const source = await readFile(
    new URL("../lib/outlook-daily-sync.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /searchParams\.set\("\$filter", `receivedDateTime ge/);
  assert.match(source, /"\$orderby", "receivedDateTime desc"/);
});
