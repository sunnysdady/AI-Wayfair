# Wayfair 项目监工记录 2026-06-06

## 当前角色分工

- Claude：继续完成项目实现和页面打磨。
- Codex：做项目监工，负责检查进度、发现风险、跑验收、及时推送 GitHub 备份，方便换电脑接力。

## 当前 Git 基线

远端仓库：`https://github.com/sunnysdady/AI-Wayfair`

当前需要保留的最新工作：

- Claude 已推进到 `0622ce5 docs: sync README to v0.3 state`
- Codex 本地追加了库存字段兼容修复：`fix: support inventory fields in ops task rules`
- 该修复已通过本地规则测试和库存字段探针，推送后应成为远端最新提交之一。

换电脑后先执行：

```bash
cd "/Users/pengzhang/Documents/Codex 2/AI-Wayfair"
git pull origin main
git log --oneline -8
git status --short --branch
```

如果本地路径不同，先进入新的 `AI-Wayfair` 仓库根目录。

## 已完成状态

1. 定价体检表已生成并修复为可读 Dashboard 页面。
2. SKU 任务清单、运营执行中心、SKU 经营档案已生成。
3. Claude 已补充执行中心 v0.1/v0.2、交互任务状态、表格布局、甘特图样式、README 和接力文档。
4. Codex 已补上库存数据字段兼容：
   - 支持 `SupplierPart`
   - 支持 `Wayfair店铺SKU`
   - 支持 `YB中文名`
   - 避免 pandas `NA` / `NaN` 破坏字段兜底

## 已验证检查

```bash
python3 scripts/test_build_ops_workbench.py
```

结果：4 个规则测试通过。

库存任务探针结果：

- 库存任务生成数量：126
- 第一条任务有真实供应商 SKU
- 任务 ID 不再退化为 `TASK-SKU-INVENTORY-001`

字段兜底探针结果：

- 当中文字段为空但英文/备用字段存在时，`base_fields()` 能正确取到备用值。

## 当前发现的风险

### 1. 只运行 `build_ops_workbench.py` 会让 3 个报告退回简版样式

监工检查时发现，单独运行：

```bash
python3 scripts/build_ops_workbench.py
```

会重新写出以下 3 个 HTML：

- `reports/Wayfair_运营执行中心_20260605.html`
- `reports/Wayfair_SKU任务清单_20260605.html`
- `reports/Wayfair_SKU经营档案_20260605.html`

这些文件会暂时丢失 Dashboard shell。正确流程必须继续运行：

```bash
python3 scripts/apply_dashboard_shell.py
```

然后再检查页面视觉效果。不要把只运行生成脚本后的简版 HTML 直接提交。

### 2. `apply_dashboard_shell.py` 会替换 `<head>`

页面专有 CSS / JS 必须放在 `<body>` 内，否则套壳后会丢失。甘特图和任务表已经出现过这个问题。

### 3. 表格必须保持固定列宽和截断

执行中心和任务清单的长文本列必须保持：

- 固定列宽
- 触发原因、建议动作、复盘指标多行截断
- 按钮文字横排
- 移动端可横向滚动

如果新增表格，注意 `dashboard-shell.js` 的表格最小宽度注入逻辑。

## 下一阶段建议让 Claude 做什么

优先级按顺序执行：

1. 重新跑完整生成链路：

```bash
python3 scripts/build_ops_workbench.py
python3 scripts/apply_dashboard_shell.py
```

2. 检查 Git 变化，只允许提交预期文件：

```bash
git status --short
git diff --stat
```

3. 本地预览核心页面：

```bash
python3 -m http.server 8787 --directory reports
```

重点看：

- `Wayfair_运营执行中心_20260605.html`
- `Wayfair_SKU任务清单_20260605.html`
- `Wayfair_SKU经营档案_20260605.html`
- `Wayfair_产品定价体检表_20260605.html`

4. 检查页面是否满足用户要求：

- 有 Dashboard 跳转分类
- 表头中文
- 表格不乱码
- 不是只堆表格，要有结论、优先级、动作
- SKU 可查看 Total Cost 明细
- 定价口径清楚：平台利润空间 = `Retail Price Net - Total Cost`
- 不把 `Wholesale Cost < Total Cost` 误判成单件亏损

5. 每完成一个可用版本就提交并推送：

```bash
git add <intended files>
git commit -m "<clear message>"
git push origin main
```

## 监工验收门槛

没有同时满足以下条件，不算完成：

- `python3 scripts/test_build_ops_workbench.py` 通过
- 核心 HTML 页面仍然有统一 Dashboard shell
- 首页或侧栏能跳到核心报告
- 任务清单可读，按钮不竖排，长文本不撑爆
- 生成后的 CSV / HTML 没有客户隐私或原始订单明细
- README 和接力文档描述与实际页面一致
- GitHub 已推送，Vercel 可部署

## 给下一轮 Codex 的提醒

用户现在不是要更多解释，而是要能执行的运营系统。输出要少讲概念，多给：

- 哪些 SKU 先处理
- 为什么先处理
- 怎么处理
- 做完怎么判断有效
- 哪些数据还缺
- 哪些动作禁止做

