import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("locks new SKU operating-center UI to the Wayfair AI brand kit", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const rootTokens = styles.slice(0, styles.indexOf("}\n") + 1);
  const skuStyles = styles.slice(
    styles.indexOf("/* SKU operating demo:"),
    styles.indexOf("/* Product Addition V2:"),
  );
  const skuCenter = page.slice(page.indexOf("function SkuOperatingCenter()"));

  for (const token of [
    "--brand-font-sans",
    "--brand-font-mono",
    "--brand-color-primary",
    "--brand-color-surface",
    "--brand-color-ink",
    "--brand-color-muted",
    "--brand-color-line",
    "--brand-panel-strong",
  ]) {
    assert.match(rootTokens, new RegExp(`${token}:`));
  }
  assert.match(styles, /body\{[^}]*font-family:var\(--brand-font-sans\)/);
  assert.match(skuStyles, /var\(--brand-panel-strong\)/);
  assert.doesNotMatch(skuStyles, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(skuCenter, /style=\{\{/);
});
