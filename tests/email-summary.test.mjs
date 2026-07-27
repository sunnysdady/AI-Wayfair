import assert from "node:assert/strict";
import test from "node:test";

import { normalizeEmailBriefItem } from "../lib/email-summary.mjs";

test("keeps the PO and shipping service while removing order boilerplate", () => {
  const result = normalizeEmailBriefItem({
    category: "订单履约",
    subject: "Action Required: PO# CS670434030 -- Ship FedEx Home Delivery",
    summary: "ACTION REQUIRED:\nPO #: CS670434030 -- Ship FedEx Home Delivery",
    bodyPreview: "TO DO\nPlease Note: Shipping FedEx Home Delivery (See Below)\nWayfair expects all fulfilled items containing composite wood to be CARB and TSCA Title VI compliant\nRegister and Fulfill PO",
  });

  assert.match(result.summary, /CS670434030/);
  assert.match(result.summary, /FedEx Home Delivery/);
  assert.doesNotMatch(result.summary, /CARB|TSCA|composite wood/i);
  assert.doesNotMatch(result.bodyPreview, /^ACTION REQUIRED|^TO DO|CARB|TSCA/im);
});

test("reduces the collapsed production order text to atomic business facts", () => {
  const result = normalizeEmailBriefItem({
    category: "订单履约",
    subject: "Action Required: PO# CS670434030 -- Ship FedEx Home Delivery",
    summary: "ACTION REQUIRED: PO #: CS670434030 -- Ship FedEx Home Delivery TO DO Please Note: Shipping FedEx Home Delivery (See Below) Wayfair expects all fulfilled items containing composite wood to be CARB and TSCA Title VI compliant Register and Fulfill P 明确日期：07/29/2026。",
    bodyPreview: "",
  });

  assert.equal(result.summary, "PO #CS670434030 · FedEx Home Delivery；截止日期 07/29/2026");
  assert.equal(result.bodyPreview, "PO #CS670434030 · FedEx Home Delivery\n截止日期 07/29/2026");
  assert.doesNotMatch(result.summary, /ACTION REQUIRED|TO DO|Please Note|CARB|TSCA|composite wood|See Below|Register/i);
});

test("includes order number, SKU, product name, quantity, and amount", () => {
  const result = normalizeEmailBriefItem({
    category: "订单履约",
    subject: "Action Required: PO# CS670434030 -- Ship FedEx Home Delivery",
    summary: "Must Ship By 07/29/2026",
    bodyPreview: "",
    order: {
      poNumber: "CS670434030",
      currency: "USD",
      totalQuantity: 1,
      totalAmount: 126,
      items: [{
        sku: "4T-Kayak",
        name: "Freestanding 4-tier Kayak & Canoe Storage Rack, Black",
        quantity: 1,
        unitPrice: 126,
      }],
    },
  });

  assert.match(result.summary, /订单号 CS670434030/);
  assert.match(result.summary, /SKU 4T-Kayak/);
  assert.match(result.summary, /商品 Freestanding 4-tier Kayak/);
  assert.match(result.summary, /数量 1/);
  assert.match(result.summary, /金额 USD 126\.00/);
  assert.match(result.summary, /FedEx Home Delivery/);
  assert.match(result.summary, /截止 07\/29\/2026/);
});

test("prioritizes structured remittance facts over generic finance prose", () => {
  const result = normalizeEmailBriefItem({
    category: "账单/回款",
    subject: "Payment Remittance",
    summary: "Please note that your payment has been processed. Thank you.",
    bodyPreview: "This email is intended for the named recipient.\nManage your preferences",
    financial: {
      amount: 18240.56,
      currency: "USD",
      remittanceId: "10002005889913",
      paymentDate: "2026-07-20",
      paymentMethod: "ACH",
      invoiceIds: ["INV-1001"],
    },
  });

  assert.match(result.summary, /USD 18240\.56/);
  assert.match(result.summary, /10002005889913/);
  assert.match(result.bodyPreview, /2026-07-20/);
  assert.match(result.bodyPreview, /ACH/);
  assert.doesNotMatch(result.bodyPreview, /intended recipient|preferences/i);
});

test("extracts remittance and attachment while removing invisible formatting", () => {
  const result = normalizeEmailBriefItem({
    category: "账单/回款",
    subject: "Payment Remittance - #10002005943962",
    summary: "账单/回款：͏ ‌ ͏ ‌ ͏ ‌ 附件：Wayfair_Remittance_10002005943962.csv。",
    bodyPreview: "",
  });

  assert.equal(result.summary, "汇款单 #10002005943962；附件 Wayfair_Remittance_10002005943962.csv");
  assert.doesNotMatch(result.summary, /[\u034f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/);
});

test("keeps identifiers, deadline, and exception for other operational mail", () => {
  const result = normalizeEmailBriefItem({
    category: "其他运营",
    subject: "Supplier case update",
    summary: "General account information is available in Partner Home.",
    bodyPreview: "Case #WF-48291 is blocked because the document is missing.\nPlease submit the document by 2026-07-29.\nBest regards",
  });

  assert.match(result.summary, /WF-48291/);
  assert.match(result.summary, /blocked|missing/i);
  assert.match(`${result.summary}\n${result.bodyPreview}`, /2026-07-29/);
  assert.doesNotMatch(result.bodyPreview, /Best regards/i);
});
