import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import test from "node:test";

import {
  buildSignPayload,
  generateLingxingSign,
  mapLingxingInventoryRows,
} from "../lib/lingxing.mjs";

test("signs Lingxing requests with sorted query, MD5 and AES-128-ECB", () => {
  const params = { timestamp: "1710000000", sku: "B01PF-002WMJ", access_token: "tok", app_key: "1234567890abcdef" };
  const payload = buildSignPayload(params);
  assert.equal(payload, "access_token=tok&app_key=1234567890abcdef&sku=B01PF-002WMJ&timestamp=1710000000");
  const md5 = createHash("md5").update(payload, "utf8").digest("hex").toUpperCase();
  const cipher = createCipheriv("aes-128-ecb", Buffer.from("1234567890abcdef"), null);
  const expected = Buffer.concat([cipher.update(md5, "utf8"), cipher.final()]).toString("base64");
  assert.equal(generateLingxingSign(params, "1234567890abcdef"), expected);
});

test("maps warehouse ids and sums aliased overseas warehouses onto stock rows", () => {
  const rows = mapLingxingInventoryRows(
    [
      { sku: "B01PF-002WMJ", wid: 11, product_valid_num: 4, quantity_receive: 1, product_onway: 0, good_lock_num: 0 },
      { sku: "B01PF-002WMJ", wid: 12, product_valid_num: 6, quantity_receive: 2, product_onway: 3, good_lock_num: 1 },
      { sku: "", wid: 11, product_valid_num: 9 },
    ],
    [
      { wid: 11, name: "派速捷 XHNJ02仓" },
      { wid: 12, name: "派速捷 MSNJ01仓", t_warehouse_name: "MSNJ01仓" },
    ],
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.filter((row) => row.warehouse === "派速捷 XHNJ02仓")[0], {
    rowNumber: 2,
    lingxingSku: "B01PF-002WMJ",
    warehouse: "派速捷 XHNJ02仓",
    productName: "",
    available: 4,
    locked: 0,
    incoming: 1,
    transferInTransit: 0,
  });
  assert.equal(rows.filter((row) => row.warehouse === "MSNJ01仓")[0].available, 6);
});
