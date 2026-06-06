# Claude 工作验收审计 2026-06-06

审计人：Codex  
审计对象：Claude 推进后的 `main` 分支执行中心 / 任务清单 / SKU 档案 / README / 接力文档。

## 验收结论

当前版本可以继续交给 Claude 迭代，但有一个数据安全问题已由 Codex 当场修复：

- 原始导出报表曾被 Git 跟踪，已从 Git 索引移除。
- `.gitignore` 已补充 `data/raw/`，后续原始数据只保留本地，不进入 GitHub。

## 已通过检查

### 生成链路

```bash
python3 scripts/test_build_ops_workbench.py
python3 scripts/build_ops_workbench.py
python3 scripts/apply_dashboard_shell.py
```

结果：

- 规则测试 4 个通过。
- 生成 SKU 档案 90 行。
- 生成运营任务 178 条。
- 任务优先级：P0 65 条，P1 110 条，P2 3 条。
- 套壳后工作区无未提交报告差异。

### 数据结构

- `data/Wayfair_运营任务清单_20260605.csv`：178 行，16 列。
- `data/Wayfair_SKU经营档案_20260605.csv`：90 行，27 列。
- `data/Wayfair_产品定价体检表_20260605.csv`：90 行，56 列。

任务清单检查：

- 空供应商 SKU：0。
- 重复任务 ID：0。
- 退化库存任务 ID `TASK-SKU-INVENTORY-001`：0。
- 空建议动作：0。
- 空证据链接：0。

定价口径检查：

- 平台空间金额公式无误：`Cost Stack净零售价 - Wayfair Total Cost`。
- 平台空间率公式无误：`平台空间金额 / Cost Stack净零售价`。
- 可计算 82 行中，公式误差行：0。
- `Wholesale Cost < Total Cost` 是正常口径，因为 `Total Cost` 包含 Wholesale Cost，不应误判为单件亏损。

### 页面检查

本地预览端口：`http://127.0.0.1:8788`

抽查页面：

- `Wayfair_运营执行中心_20260605.html`
- `Wayfair_SKU任务清单_20260605.html`
- `Wayfair_SKU经营档案_20260605.html`
- `Wayfair_产品定价体检表_20260605.html`
- `Wayfair_6月待办甘特图_20260604.html`

结果：

- 页面标题正确。
- Dashboard CSS 存在。
- 侧栏存在。
- 无明显乱码。
- 控制台无 error / warning。
- 核心表格存在。
- 甘特图彩色条存在。
- 任务按钮交互通过：第一条任务从“待执行”切换为“执行中”。

线上检查：

- `https://ai-wayfair.vercel.app/reports/Wayfair_运营执行中心_20260605.html` 返回 200。
- 线上 HTML 包含 Dashboard shell、执行中心标题、侧栏、`exec-tbl`。

## 发现的问题

### P0 已修复：原始报表进入 Git 跟踪

问题：

`data/raw/` 下 10 个原始 CSV/XLSX 文件曾被 Git 跟踪，违反项目数据安全红线。

处理：

- 从 Git 索引移除这些文件。
- 保留本地文件。
- `.gitignore` 增加 `data/raw/`。

后续要求：

- 不允许提交 `data/raw/`。
- 若 GitHub 历史需要彻底清理，另起专项任务处理历史记录清洗。

### P2：项目导航页与文档描述不完全一致

检查发现：

- `reports/Wayfair_项目导航_20260604.html` 没有 Dashboard shell。
- `scripts/apply_dashboard_shell.py` 明确跳过文件名包含“项目导航”的页面。
- README 写的是 `reports/` 下所有 HTML 报告已套 Dashboard shell。

处理建议：

- 二选一：
  - 把项目导航页也套壳。
  - 或把 README 改为“核心报告已套 Dashboard shell，项目导航页为独立入口页”。

当前不阻断运营使用。

## 下一步给 Claude 的要求

1. 后续每次跑 `build_ops_workbench.py` 后，必须继续跑 `apply_dashboard_shell.py`。
2. 不要提交 `data/raw/`。
3. 如果改核心 HTML，必须浏览器抽查执行中心、任务清单、SKU 档案、定价体检。
4. 不要只堆表格，页面必须保留结论、优先级、动作、证据入口。
5. 若处理项目导航页，先决定它是独立入口页还是 Dashboard 内页，再改 README。

