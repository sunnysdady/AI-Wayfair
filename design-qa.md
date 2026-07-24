# Design QA — sidebar subnavigation and interaction audit

Date: 2026-07-17

## Evidence

- Reference: `design-qa/01-reference.png`
- Implementation: `design-qa/02-implementation.png`
- Side-by-side and focused comparison: `design-qa/03-comparison.png`
- Comparison viewport: 2446 × 1670
- State: 计划与复盘 → 运营计划 → 7月执行计划

## Flow audit

1. Dashboard — healthy. Date presets and custom range are real controls; the Outlook item is now a real external link instead of a dead button.
2. 广告 — healthy. The left navigation expands to 广告管理器 / AI 优化, and each child changes the page heading and content.
3. 计划与复盘 — healthy. The left navigation expands to 运营计划 / 复盘资料. June, July and August context cards now navigate to the corresponding review or plan instead of only looking selected.
4. 商品与库存 — healthy. The left navigation expands to 库存更新 / 商品数据, and each child changes the working surface.
5. Narrow layout — healthy from DOM and breakpoint checks. The active child is marked with `aria-current` and automatically scrolled into view at widths up to 760px.

## Findings resolved

- Removed the horizontal secondary navigation from the content area.
- Removed duplicate child-page heading rows from planning, review, inventory and catalog.
- Reused the main page heading for the active child workspace.
- Added working navigation to month context cards and the reverse path from review to July/August plans.
- Replaced the dead Outlook button with a real link.
- Added an automated test that rejects `<button>` elements without an action handler.
- Added `aria-current` and `aria-expanded` state to sidebar navigation.

## Evidence limits

- Visual and interaction checks cover the local application with current local API configuration. Production-only Wayfair API responses were not mutated during this design audit.
- Screenshot review cannot establish full keyboard or screen-reader compliance; semantic navigation state and actionable controls were checked in the DOM.

## QA history

- Previous baseline (2026-07-16): matched the user-provided purple Wayfair email brief, verified the original navigation, daily/weekly/monthly linkage, 2320px wide workspace, 390×844 mobile stacking, core data controls and production-write gates. Evidence remains in `artifacts/reference-comparison.png` and `artifacts/daily-mobile.png`.
- Pass 1: found content-area secondary navigation, inactive month cards, a dead Outlook button and repeated child headings.
- Pass 2: moved child navigation left, made month cards functional, removed repeated headings and verified all four workspaces.
- Pass 3: added narrow-layout active-item auto-scroll and reran the full automated suite.

final result: passed
