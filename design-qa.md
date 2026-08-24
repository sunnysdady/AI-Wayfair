# SKU 经营中心 Demo — Design QA

**Source visual truth**

- 原始参考图：`/var/folders/x9/_w038l2d24q4bvwjk6p44zqc0000gn/T/codex-clipboard-0523711e-fc17-4a14-9bb5-dddbf06e0037.png`
- 实现截图：`/Users/mac/Documents/wayfair 店铺复盘/wayfair-ai-sites/design-qa/sku-demo-queue-640x1280.png`
- 同图对比证据：`/Users/mac/Documents/wayfair 店铺复盘/wayfair-ai-sites/design-qa/reference-vs-sku-demo-640x1284.png`

**Comparison setup**

- Source pixels：640 × 1284。
- Implementation capture：625 × 1216；浏览器 CSS viewport：640 × 1280，deviceScaleFactor：1。
- Normalization：实现截图在同图对比中等比扩展到 640 × 1284；没有比较浏览器 chrome。
- State：商品经营 → SKU 经营中心 → SKU 队列与 360°；全部队列（4 条），首条 DMOM1022 选中，页面滚动位置为顶部。
- Full-view evidence：`reference-vs-sku-demo-640x1284.png` 将原参考图与实现截图置于同一输入中。重点比对品牌色、白色工作区、轻边框和紧凑的信息密度；主导航结构的变化属于本次 IA 重构的有意偏离。
- Focused region：已查看“SKU 队列与 360°”的筛选区、四条 SKU 卡片和首条详情首屏。该区域含本次新增的主交互，需单独核对；品牌标识使用项目中已有的 W 标记，没有用代码重绘参考图中的 Logo。

**Findings**

- 没有 P0/P1/P2 视觉问题。
- [P3] 窄视口下，顶部产品视图条的标签较密。
  - Location：`.workspace-tabs`。
  - Evidence：640px 对比图中四个标签保持单行，文字仍可读但横向余量较小。
  - Impact：不影响队列、筛选或 SKU 选择；若未来增加更多产品子页，易变得拥挤。
  - Fix：新增子页时改为水平可滚动标签，或收敛为“更多”菜单。

**Required fidelity surfaces**

- Fonts and typography：延续现有项目的 sans-serif 字体、粗体层级和中文行距。Demo 的标题、KPI 数字、SKU 编号、说明文字在窄视口均无截断。
- Spacing and layout rhythm：保留左侧品牌区、白色卡片、浅灰页面背景及 12–24px 间距节奏；窄视口将业务内容改为单列，避免旧页面“树状侧栏挤占商品内容”的问题。
- Colors and visual tokens：沿用深紫、淡紫、米白、灰色边界及成功/风险弱提示色；当前选中 SKU 的紫色描边与主行动按钮保持一致。
- Image quality and asset fidelity：参考图的品牌标记来自现有项目资产/组件；本次 SKU 工作台不新增需要拟真的商品图片或图标资产。
- Copy and content：核心文案明确区分“经营建议”“证据”“人工确认”“不触发写操作”，SKU 数据为可识别的演示数据。

**Interaction evidence**

- 点击“优先修复”后，队列从 4 条过滤为 2 条。
- 点击 `DMOM1018` 后，详情切换为“SKU 360° · 质量视角”。
- 点击“查看经营边界”后，出现“当前运营角色与利润审计”和只读动作约束说明。
- 浏览器控制台错误：0。

**Comparison history**

- Iteration 1：初次窄视口截图继承了上一状态的页面滚动位置，Hero 顶部被裁切；结论为 blocked。
- Fix：重置页面滚动至顶部后重新捕捉 `sku-demo-queue-640x1280.png`，并生成同图对比证据。
- Iteration 2：Hero、KPI、队列筛选、SKU 卡片和详情首屏完整可见；没有 P0/P1/P2 差异。

**Implementation checklist**

- [x] 保留原项目的紫色品牌、浅色卡片和桌面侧栏基调。
- [x] 将 SKU 首页改为按经营意图分流的队列。
- [x] 让筛选、SKU 选择和经营约束页签可用。
- [x] 核对窄视口和桌面布局，以及控制台错误。

**Final result**

passed

---

## Historical QA baseline (preserved)

The following was the previous tracked audit and remains relevant to the older
sidebar/subnavigation scope. This SKU Demo section supersedes it only for the
current product workspace.

- Date: 2026-07-17.
- Evidence: `design-qa/01-reference.png`, `design-qa/02-implementation.png`,
  and `design-qa/03-comparison.png`; comparison viewport 2446 × 1670.
- State: 计划与复盘 → 运营计划 → 7月执行计划.
- Verified flows: Dashboard date controls, 广告 child navigation, 计划与复盘
  month-context navigation, 商品与库存 child navigation, and narrow-layout
  `aria-current` / auto-scroll behavior.
- Resolved then: content-area secondary navigation, duplicate child headings,
  inactive month cards, dead Outlook button, and missing sidebar ARIA state.
- Previous final result: passed.
