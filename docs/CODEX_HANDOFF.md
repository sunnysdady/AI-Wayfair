# Grok → Codex 增量交接（仅 Grok 做过的部分）

> Codex 已有完整仓库、`AGENTS.md`、生产 Droplet 和发布脚本。不要按「从零接管项目」来读。
> 本文只交代 2026-09-17～09-19 Grok 会话里实际查过、改过、上过生产的库存工作。
> 生成：2026-09-19 12:16 JST

---

## 用户交给 Grok 的任务

Wayfair 报表 `347069.xlsx`（供应商 347069 广州 youbao）里这些 SKU 因库存同步被卡住、产生丢单，要求解除 hold：

| Part | 市场 |
|---|---|
| MFC-D3-W | US + CA |
| MFC-D3-B | US |
| MFC-D2B | US |
| 4T-Kayak | US |

对照文件：领星 `库存明细-仓库库存-20260917-959019149317464064.xlsx`（只在会话里，未进 Git）。

---

## Grok 查到的库存事实（2026-09-17 当天）

映射到 Wayfair 的四个仓里：

| 领星 SKU | 对应关系 | 当天可用量 |
|---|---|---|
| `B01PF-002WM` / `002BM` / `001BM` | 旧映射（无 J） | **四仓全 0** |
| `B01PF-002WMJ` | 三斗白 | 有货 |
| `B01PF-002BMJ` | 三斗黑 | 有货 |
| `B01PF-001BMJ` | 二斗黑 | 有货 |
| `B01PF-001WMJ` | 二斗白 | 有货（顺手一起改，避免白柜漏映射） |
| `B01KS-003BM` | 4T-Kayak | **四仓真 0** |
| `B01KS-004BM` | 8T-Kayak | LA10 当时 85 |

`派速捷 MSNJ01仓` 有大量库存，旧映射不认这个仓名，等于这批货从来没进过 Wayfair supplier。

结论：抽屉不是没货，是映射指错 SKU；4T 是真没货，不能靠改映射「解冻」。

---

## Grok 落地的代码（不要回滚）

### 1. MFC 抽屉改指 J 后缀

`lib/inventory-mapping.json`：

| Wayfair Part | 领星 SKU |
|---|---|
| MFC-D3-W / MFC-D3W | `B01PF-002WMJ` |
| MFC-D3-B / MFC-D3B | `B01PF-002BMJ` |
| MFC-D2B / MFC-D2-B | `B01PF-001BMJ` |
| MFC-D2W / MFC-D2-W | `B01PF-001WMJ` |

4T-Kayak **没改**。生产上它本来就被 `86fdf567` unlink，继续保持 0，避免把空 SKU 推回 Castle。

### 2. MSNJ01 并进 360343

生产映射（pipe，数量求和）：

```text
supplierId 360343
warehouse  派速捷 XHNJ02仓|派速捷 MSNJ01仓
```

`main` 骨架用的是 `aliases[]`，和 production 文件形状不同。改生产继续用 pipe。

### 3. 相关 commit

| SHA | 分支 | 内容 |
|---|---|---|
| `2fdad6ec` | `main` | 抽屉 J 后缀（Sites 骨架那份 mapping） |
| `6e0da776` | `production` | 抽屉 J 后缀 |
| `9d741a93` | `production` | MSNJ01 → XHNJ02 / 360343 |
| `9adf4cba` | `production` | pipe 仓名求和 |
| `80f047e` | `production` | 第一次把领星拉库存合进 Droplet → **Next build 因 sync route implicit any 失败，已回滚到 `9adf4cb`** |
| `6292497e` | `production` | 给 sync route 补类型，生产构建通过。这是领星功能真正站上 Droplet 的点 |
| `a23355e6` / `cedca24c` | `production` | 同一次上线顺手修的镜像构建串行、compose `COMPOSE_PARALLEL_LIMIT`（不要再传 `--parallel 1` 当服务名） |

`main` 上 Grok 还留过本地 commit `e0a2f76`（Sites 骨架领星 OpenAPI）。那棵树不是 Droplet 生产，Codex 不必接。

---

## 明确不是 Grok 增量、不必在这份里重做的

这些是你们在 Codex / 仓库里已经有的，Grok 没要求 Codex 重写：

- 15 分钟 cron TRUE_UP、共享快照 `/var/lib/lingxing/inventory-raw.json`、1.05s 节流、SKU×仓指纹跳过
- 库存页看板主卡排版
- `docs/architecture.md`、发布脚本、`AGENTS.md`

Grok 上一版交接把整仓架构又写了一遍，作废。以本文件为准。

---

## 留给 Codex 的收尾（只这几条）

1. 抽一次生产库存页，确认 MFC-D3-W / D3-B / D2B 已经是 J 后缀数量，不再全 0。
2. 确认 4T-Kayak 仍为 0。领星有货之前不要映射回 `B01KS-003BM`。
3. `CHANGELOG.md` 还停在 2026-08-27，9 月映射和领星上线没记。若你们管 changelog，补一笔即可。
4. 不要把 `347069` 写进 `warehouseMappings`。那是店铺/报表供应商号；仓 supplierId 仍是 `360342/343/344/346` 和 `347072`。

---

## 给 Codex 的短提示

```text
只接 Grok 2026-09-17～19 的库存增量，不要重做整仓。
production 已改：MFC 抽屉 → *J 后缀；MSNJ01 并进 360343（pipe 仓名）。
4T-Kayak 保持 unlink。
领星进 Droplet 的可用点是 6292497e；80f047e 构建失败已回滚。
先核对库存页这四个 Part 的数量，有问题再动 mapping。
```
