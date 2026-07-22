import assert from "node:assert/strict";
import test from "node:test";

import { financialDetailsForEmail } from "../lib/email-finance.mjs";

test("uses structured remittance fields for the finance preview", () => {
  const details = financialDetailsForEmail({
    subject: "Payment Remittance - #10002005889913",
    category: "账单/回款",
    summary: "Wayfair 已发起汇款。",
    financial: {
      remittanceId: "10002005889913",
      amount: 18240.56,
      currency: "USD",
      paymentDate: "2026-07-20",
      paymentMethod: "ACH",
      invoiceIds: ["INV-1001", "INV-1002"],
    },
  });

  assert.equal(details.isFinancial, true);
  assert.equal(details.remittanceId, "10002005889913");
  assert.equal(details.amountLabel, "$18,240.56");
  assert.equal(details.paymentDate, "2026-07-20");
  assert.equal(details.paymentMethod, "ACH");
  assert.deepEqual(details.invoiceIds, ["INV-1001", "INV-1002"]);
});

test("extracts only the remittance id from legacy summaries and never invents an amount", () => {
  const details = financialDetailsForEmail({
    subject: "Payment Remittance - #10002005889913",
    category: "账单/回款",
    summary: "Payment Remittance - #10002005889913",
  });

  assert.equal(details.isFinancial, true);
  assert.equal(details.remittanceId, "10002005889913");
  assert.equal(details.amountLabel, "待邮件同步");
  assert.equal(details.paymentDate, "待邮件同步");
  assert.deepEqual(details.invoiceIds, []);
});

test("does not render finance details for normal operating mail", () => {
  const details = financialDetailsForEmail({
    subject: "Ship FedEx Home Delivery",
    category: "订单履约",
    summary: "请完成交接检查。",
  });

  assert.equal(details.isFinancial, false);
});
