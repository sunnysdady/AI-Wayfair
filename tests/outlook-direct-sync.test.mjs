import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as outlookSync from "../lib/outlook-daily-sync.mjs";
import {
  buildDailyReports,
  selectTargetMailFolders,
  syncOutlookDaily,
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

test("parses Wayfair remittance CSV into verified finance fields", () => {
  const csv = [
    "Wayfair Remittance #: 10002005965230",
    "For Supplier: Example Supplier",
    "Date: 2026-07-31",
    "",
    "Total (USD):,565.88,To be sent via Bank transfer",
    'EPD Amount (USD):,-12.04,"Early pay discount"',
    "",
    "Invoice #,PO #,Invoice Date,Product Amount,Wayfair Allowance for Damages/ Defects [4.00%],Shipping,Other,Tax/VAT,Payment Amount,Business,Order Type",
    '"CS665252351","CS665252351",2026-07-02,108.00,-4.32,0.00,0.00,0.00,103.68,Wayfair,Dropship',
    '"CS665201357","CS665201357",2026-07-01,108.00,-4.32,0.00,0.00,0.00,103.68,Wayfair,Dropship',
    "",
    ",,Sub-total:,216.00,-8.64,0.00,0.00,0.00,207.36",
  ].join("\r\n");

  assert.deepEqual(outlookSync.parseWayfairRemittanceCsv(csv), {
    remittanceId: "10002005965230",
    amount: 565.88,
    currency: "USD",
    paymentDate: "2026-07-31",
    paymentMethod: "Bank transfer",
    invoiceIds: ["CS665252351", "CS665201357"],
    grossAmount: 216,
    allowanceAmount: -8.64,
    epdAmount: -12.04,
    serviceFeeAmount: 0,
  });
});

test("keeps parsed remittance details in the daily finance item", () => {
  const financial = {
    remittanceId: "10002005965230",
    amount: 565.88,
    currency: "USD",
    paymentDate: "2026-07-31",
    paymentMethod: "Bank transfer",
    invoiceIds: ["CS665252351"],
    grossAmount: 108,
    allowanceAmount: -4.32,
    epdAmount: -2.4,
    serviceFeeAmount: 0,
  };
  const reports = buildDailyReports([{
    id: "finance-csv",
    subject: "Payment Remittance - #10002005965230",
    from: { emailAddress: { address: "noreply@wayfair.com" } },
    receivedDateTime: "2026-07-28T17:33:46Z",
    isRead: true,
    bodyPreview: "Payment remittance attached",
    financial,
  }], "2026-07-29");

  assert.deepEqual(reports[0].items[0].financial, financial);
});

test("direct Outlook sync reads remittance attachment content before persisting", async () => {
  const csv = [
    "Wayfair Remittance #: 10002005965230",
    "Date: 2026-07-31",
    "Total (USD):,565.88,To be sent via Bank transfer",
    "EPD Amount (USD):,-12.04",
    "Invoice #,PO #,Invoice Date,Product Amount,Wayfair Allowance for Damages/ Defects [4.00%],Shipping,Other,Tax/VAT,Payment Amount,Business,Order Type",
    '"CS665252351","CS665252351",2026-07-02,108.00,-4.32,0.00,0.00,0.00,103.68,Wayfair,Dropship',
    ",,Sub-total:,108.00,-4.32,0.00,0.00,0.00,103.68",
  ].join("\r\n");
  const calls = [];
  const fetchImpl = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes("/oauth2/v2.0/token")) {
      return Response.json({ access_token: "graph-token" });
    }
    if (target.includes("/mailFolders?")) {
      return Response.json({
        value: [{
          id: "inbox",
          displayName: "Inbox",
          wellKnownName: "inbox",
          childFolderCount: 0,
        }],
      });
    }
    if (target.includes("/messages?")) {
      return Response.json({
        value: [{
          id: "finance-message",
          subject: "Payment Remittance - #10002005965230",
          from: { emailAddress: { address: "noreply@wayfair.com" } },
          receivedDateTime: "2026-07-28T17:33:46Z",
          isRead: true,
          bodyPreview: "Payment remittance attached",
          hasAttachments: true,
        }],
      });
    }
    if (target.endsWith("/$value")) return new Response(csv);
    if (target.includes("/attachments?")) {
      return Response.json({
        value: [{
          id: "remittance-csv",
          name: "Wayfair_Remittance_10002005965230.csv",
          contentType: "application/octet-stream",
          size: csv.length,
          isInline: false,
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };
  const batches = [];
  const db = {
    prepare(sql) {
      return {
        async run() {},
        bind(...args) {
          return { sql, args };
        },
      };
    },
    async batch(statements) {
      batches.push(...statements);
    },
  };

  await syncOutlookDaily({
    env: {
      MICROSOFT_TENANT_ID: "tenant",
      MICROSOFT_CLIENT_ID: "client",
      MICROSOFT_CLIENT_SECRET: "secret",
      OUTLOOK_MAILBOX_USER: "operator@example.com",
    },
    db,
    fetchImpl,
    now: new Date("2026-07-29T01:30:00Z"),
  });

  const briefWrite = batches.find((statement) => (
    statement.sql.includes("INSERT INTO outlook_daily_briefs")
    && statement.args[0] === "2026-07-29"
  ));
  const report = JSON.parse(briefWrite.args[1]);
  assert.equal(report.items[0].financial.amount, 565.88);
  assert.equal(report.items[0].financial.paymentMethod, "Bank transfer");
  assert.deepEqual(report.items[0].financial.invoiceIds, ["CS665252351"]);
  assert.ok(calls.some((target) => target.endsWith("/$value")));
});
