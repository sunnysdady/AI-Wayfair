# Codex Supervisor

本目录是给下一台电脑上的 Codex / Claude 接力用的监工区。

业务文档、报告、数据仍然放在原来的 `docs/`、`reports/`、`data/`。这里不放原始数据，只记录项目状态、验收门槛、风险点和下一步执行要求。

## 新会话先读

1. `codex-supervisor/project-watch-20260606.md`
2. `docs/Wayfair_接力文档_20260606.md`
3. `docs/superpowers/plans/2026-06-05-wayfair-ai-ops-workbench-v0.1.md`
4. `README.md`

## 监工原则

- Claude 可以继续实现，Codex 负责验收、记录、备份和指出风险。
- 每个阶段完成后必须先跑检查，再提交，再推送 GitHub。
- 不提交原始订单、客户、账号、导出报表原文件，只提交脱敏汇总和 HTML 报告。
- 如果生成报告导致 Dashboard 外壳、中文表头、可读性或跳转失效，先修复再提交。

