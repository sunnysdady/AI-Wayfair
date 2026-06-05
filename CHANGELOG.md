# Changelog

## [v0.3] - 2026-06-06

### Fixed
- **全站表格排版**（commit abc9c92）：所有带表格页面列宽失控、按钮文字竖排、长文字撑破行高。
  - 根本原因：shell JS 对所有 `<table>` 统一注入 `min-width:columns×130px`，且无 `<colgroup>`，浏览器按内容分配列宽。
  - 修复：`table-layout:fixed` + `<colgroup>` 固定宽度 + `.lc2/.lc3/.lc4` 文字截断 + shell JS 排除 `task-tbl`/`exec-tbl`。
- **甘特图进度条不显示**（commit 880d0c5）：6月待办甘特图打开只有数字，彩色 bar 完全消失。
  - 根本原因：Gantt CSS 原在 `<head>`，被 `apply_dashboard_shell.py` 整体替换后丢失。
  - 修复：将 `.gantt`/`.cell`/`.bar`/`.dot` 等样式直接内嵌到 `<body>` 中。

### Verified
- 全量 20 个 HTML 报告页面视觉验收通过（本地 localhost:8787 逐页截图确认）。

---

## [v0.2] - 2026-06-05

### Added
- **运营执行中心**（`Wayfair_运营执行中心_20260605.html`）：P0/P1 执行任务聚合视图，作为每日第一入口。
- **SKU 任务清单 v0.2**（`Wayfair_SKU任务清单_20260605.html`）：新增执行状态追踪，通过 localStorage（key: `wf2:<taskId>`）持久化"待执行/执行中/已完成"状态，无需后端。
- **SKU 经营档案 v0.2**（`Wayfair_SKU经营档案_20260605.html`）：合并定价、促销准入、Cost Stack 数据的 SKU 卡片视图。

### Changed
- README 使用顺序调整：执行中心 → 任务清单 → SKU档案 → 证据层报告。

---

## [v0.1] - 2026-06-04

### Added
- 项目初始化，建立 Dashboard 框架（`apply_dashboard_shell.py`）。
- 首批报告：店铺诊断、店铺交接、SKU分层与促销准入、SKU价值分级、定价体检、库存映射、广告调整、CostStack口径校准、操作护栏、数据补齐清单、甘特图、项目导航。
- `dashboard-shell.css` / `dashboard-shell.js` 统一侧栏 + 顶栏 + KPI 面板样式。
- `build_ops_workbench.py` 核心生成脚本骨架。
