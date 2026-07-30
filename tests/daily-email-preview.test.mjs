import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps daily email details inside the operations center without clipping rows", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const dailyStart = page.indexOf("function Daily()");
  const dailyEnd = page.indexOf("function Plan(", dailyStart);
  const daily = page.slice(dailyStart, dailyEnd);

  assert.ok(dailyStart > 0 && dailyEnd > dailyStart);
  assert.match(daily, /const \[previewEmail, setPreviewEmail\]/);
  assert.match(daily, /<button[^>]+className="daily-mail-row"/);
  assert.doesNotMatch(daily, /<a href=\{item\.webLink\}/);
  assert.match(daily, /role="dialog"/);
  assert.match(daily, /aria-modal="true"/);
  assert.match(daily, /aria-labelledby="email-preview-title"/);
  assert.match(daily, /email-finance-summary/);
  assert.match(daily, /实际汇款/);
  assert.match(daily, /关联发票/);
  assert.match(daily, /aria-label="日报 JSON"/);
  assert.match(daily, /onClick=\{importDailyBrief\}/);
  assert.match(daily, /fetch\("\/api\/email\/daily"/);
  assert.match(daily, /onKeyDown=\{\(event\) => \{ if \(event\.key === "Escape"\) setPreviewEmail\(null\); \}\}/);
  assert.match(styles, /\.daily-mail-list\.outlook-mail-list\{margin:0/);
  assert.match(styles, /\.email-preview-overlay\{/);
  assert.match(styles, /\.email-preview-dialog\{/);
  assert.match(styles, /\.email-finance-summary\{/);
  assert.match(styles, /\.daily-import\{/);
});
