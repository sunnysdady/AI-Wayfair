# CLAUDE.md

## 协作规则（用户指定，所有会话必须遵守）

1. **主动找问题，交付前自己跑一轮审计。** 不要只做被点名的改动：改完后用脚本/检查清单全局扫一遍同类问题（断链、孤儿样式类、文本墙、失效锚点、残留 Markdown 等），修完再交付。
2. **需要做的判断不要推给用户，做完再一起汇报。** 实现过程中的取舍（命名、结构、样式语义、冲突解决）自行决定并落地，在交付汇报里说明"我做了什么判断、为什么"。只有不可逆/影响外部的大决策才提前问。
3. **不确定就明说"不确定"。** 不要把推测当事实汇报；部署/CI 状态必须实查到结果（如 Vercel READY）再回报，查不到就说明卡在哪。

## 项目结构

- `index.html`：Dashboard 门户，只做导航
- `reports/*.html`：报告页，统一壳由脚本生成
- `reports/archive/`：废弃页面归档
- `scripts/apply_dashboard_shell.py`：统一侧栏/顶栏/壳 + 共享 CSS（所有正文样式类必须在这里有定义）
- `scripts/tidy_report_tables.py`：表格去杂乱（文本墙拆条目、隐藏任务 ID 等）
- `docs/SOP_页面整理与全域审计.md`：本项目做法的可复制 SOP

## AI 执行路由

- 默认智能体：Claude / Anthropic API。需要复杂诊断、代码修改、多文件重构、运营归因时，优先使用 Claude。
- 默认环境变量：`ANTHROPIC_AUTH_TOKEN`；国内代理或网关使用 `ANTHROPIC_BASE_URL=http://127.0.0.1:15721`。
- 不再把 Reasonix / DeepSeek 作为默认执行路径。Reasonix 只允许作为低成本草稿或缓存型探索工具，且不得替代 Claude 做最终实现判断。
- 如果 Claude API 未登录或环境变量缺失，先停止并提示补认证；不要自动降级到 DeepSeek。
- 禁止提交真实 API key；只提交 `.env.example` 这类占位说明。

## 关键约定

- 信息架构五分组：今日工作 / 执行清单 / 分析与档案 / 数据与工具 / 规则与背景；执行中心是唯一工作入口
- 任务执行状态存 localStorage（key：`wf2:<taskId>`），执行中心与任务清单共享
- 报告重新生成后跑一键流水线：`bash scripts/build_all.sh`（= 生成复盘工作台 → tidy → shell → audit_site，任一步失败即停）
- 任务清单换版本时：更新 `audit_site.py` 的 EXPECT_TASK_ROWS 期望行数，并更新任务页内的 `WF_TASKS_GEN`（旧标记会自动按过期处理）
- KPI 数字只改 `apply_dashboard_shell.py` 的 KPIS/KPI_AS_OF（index 与全部报告页共用）
- 不重命名已发布的 HTML 文件（线上有外链）
- Cost Stack 口径：平台空间 = Retail Price Net − Total Cost
