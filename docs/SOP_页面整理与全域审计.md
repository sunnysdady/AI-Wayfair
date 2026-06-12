# SOP：多页面静态站点的整理、优化与全域审计

> 适用场景：一堆静态 HTML 报告页 + 一个门户首页，结构混乱/样式不一致/交付质量不稳定。
> 目标：照着本 SOP 执行，能复现"盘点 → 重排 → 去杂乱 → 全域审计 → 部署验证"的完整效果。
>
> **标注说明**
> - 🟢【照做】：机械步骤，按命令/清单执行即可，不需要发挥
> - 🟡【需判断】：需要真正动脑的步骤，SOP 给出判断框架，但答案因项目而异
> - 每个阶段末尾有"完成标准"，不达标不许进入下一阶段

---

## 第 0 阶段：接活规则（先读，贯穿全程）

1. 🟢【照做】**改完任何东西，必须跑一轮全域审计再交付**（审计脚本见第 4 阶段，直接复制运行）。
2. 🟡【需判断】**过程中的取舍自己定，交付时汇报"做了什么判断、为什么"**。判断标准：可逆的、不影响外部的（命名、样式、结构）→ 自己定；不可逆或影响外部的（删除用户数据、重命名已发布 URL、合并到生产）→ 先问。
3. 🟢【照做】**状态类结论必须实查**：说"部署完成"之前必须查到 deployment state=READY；说"无断链"之前必须跑过链接扫描。查不到就写"未确认"。

---

## 第 1 阶段：盘点（理解现状）

### 1.1 🟢【照做】列出所有页面和入口

```bash
ls -la reports/           # 所有页面文件
grep -o '<title>[^<]*</title>' reports/*.html   # 每页标题
```

### 1.2 🟢【照做】提取每个页面的导航结构

把每页侧栏/菜单的链接列出来，对比是否一致：

```bash
for f in reports/*.html; do echo "== $f"; grep -oP '(?<=wf-dot"></span>)[^<]+' "$f" | tr '\n' '|'; echo; done
```

### 1.3 🟢【照做】检查谁链接了谁

改动/删除任何文件前，先确认没有页面引用它：

```bash
grep -l '目标文件名' reports/*.html index.html
```

### 1.4 🟡【需判断】给每个页面定性

逐页回答三个问题（看标题 + 正文前 50 行即可）：
- 这页回答用户什么问题？（"今天做什么" / "为什么" / "查数据" / "别犯错"）
- 它和哪些页职责重叠？
- 它是活页面还是废弃物（旧副本、跳转占位页）？

> 判断技巧：两个页面都自称"入口/首页/工作台"= 重叠信号；文件名带旧日期且内容只有一句"已更新，请看新版"= 废弃物。

**完成标准**：一张表，每行 = 一个页面：文件名 / 一句话定位 / 分组归属（暂定）/ 活页或归档。

---

## 第 2 阶段：方案（先发方案，再动手）

### 2.1 🟡【需判断】设计信息架构

框架：按"用户带着什么问题来"分组，而不是按文件类型分组。本项目用的五分组可直接套用到同类运营站点：

| 分组 | 回答的问题 |
|---|---|
| 今日工作 | 今天/本周做什么 |
| 执行清单 | 具体怎么动手 |
| 分析与档案 | 为什么这么做 |
| 数据与工具 | 查数找数 |
| 规则与背景 | 别踩坑 |

硬性规则（🟢 这部分照做）：
- 只许有**一个**"工作第一入口"，其他自称入口的页面要改名降级或合并
- 门户首页只做导航，不承载工作内容
- 全站侧栏必须同一份，所有页面可达，当前页高亮
- 废弃页移入 `archive/` 子目录，不出现在导航（先按 1.3 确认无引用）
- **不重命名已发布的文件**（外链会断）

### 2.2 🟢【照做】把方案做成一页 HTML/文档发给用户

必含四块：现状问题（带证据）、新结构树、关键决策及理由、改动清单（编号 + 涉及文件）。用户确认或按约定"发完即执行"后再动手。

**完成标准**：用户看过方案；改动清单里每项都有对应文件。

---

## 第 3 阶段：实施

### 3.1 🟢【照做】导航/壳统一用脚本生成，不要手改 19 个文件

原则：**任何要在每个页面重复出现的东西（侧栏、顶栏、共享 CSS）都写进生成脚本**，本项目是 `scripts/apply_dashboard_shell.py`。手改单页 = 下次重新生成就丢。

脚本要点（已实现，改动时注意保持）：
- 导航分组数据写成一个列表（NAV_GROUPS），渲染逻辑只写一遍
- 用文件名关键词匹配生成链接，匹配不到返回 `#`——跑完必须 grep 检查没有 `href="#"`
- 幂等：脚本从页面里提取正文（wf-content），重新包壳；正文内嵌的 `<style>/<script>` 要落在正文区内才能存活

### 3.2 🟡【需判断】内容级优化的"度"

去杂乱的具体手法（🟢 可照搬 `scripts/tidy_report_tables.py`）：
- "；"连接的长句 → 首句加粗置顶 + 圆点列表，超过 2~3 条收进 `<details>更多 (N)</details>`
- 表格里的内部 ID（如 TASK-xxx）→ 从可见区移除，保留在 `data-*` 属性
- 整列重复的前缀文字（如"下次复盘看："）→ 删前缀，整列降级为灰色小字
- 空单元格 → CSS `td:empty:before{content:"—"}` 占位，不动数据

需判断的部分：哪些信息可以折叠（次要原因可以），哪些不能折叠（首要动作、金额、风险等级不能）；加粗只给"用户要先看的那一句"，不给整段。

### 3.3 🟢【照做】交互功能的硬性约定

- 页面间共享的状态用同一个 localStorage key 规范（本项目 `wf2:<taskId>`），新增页面接入时**复用 key，不要发明新格式**
- 可点击的元素必须有可点击的样子（边框/角标/hover/tooltip 至少两样）
- 内联 CSS/JS 必须放在正文区内（壳脚本会保留正文、丢弃 head）

**完成标准**：每项改动有对应 commit；生成脚本重跑一遍结果不变（幂等验证）。

---

## 第 4 阶段：全域审计（交付前必跑，直接复制）

> 这是本 SOP 的核心。改了 A 就要查"还有没有别的 A"。以下脚本在仓库根目录跑。

### 4.1 🟢【照做】链接完整性（每次交付前必跑）

```python
import re, pathlib
bad = 0
files = [pathlib.Path('index.html'), *sorted(pathlib.Path('reports').glob('*.html')),
         *sorted(pathlib.Path('reports/archive').glob('*.html'))]
for f in files:
    for href in re.findall(r'''href=["']([^"'#][^"']*)["']''', f.read_text()):
        if href.startswith(('http', 'mailto')): continue
        if not (f.parent / href.split('#')[0]).resolve().exists():
            print("BROKEN", f.name, href); bad += 1
print("链接OK" if not bad else f"{bad} broken")
```

### 4.2 🟢【照做】孤儿样式类（统一壳项目特有，必跑）

正文用到但共享 CSS 和页内 `<style>` 都没定义的类 = 样式丢失：

```python
import re, pathlib
css = pathlib.Path('reports/assets/dashboard-shell.css').read_text()
defined = set(re.findall(r'\.([A-Za-z][\w-]*)', css))
for f in sorted(pathlib.Path('reports').glob('*.html')):
    m = re.search(r'<main id="content" class="wf-content">(.*?)</main>', f.read_text(), re.S)
    if not m: continue
    body = m.group(1)
    inline = set(re.findall(r'\.([A-Za-z][\w-]*)',
                 ' '.join(re.findall(r'<style>(.*?)</style>', body, re.S))))
    orphans = {c for attr in re.findall(r'''class=["']([^"']+)["']''', body)
               for c in attr.split() if c not in defined and c not in inline}
    if orphans: print(f.name, sorted(orphans))
```

🟡【需判断】修复孤儿类时：先看 2~3 处实际用法再写 CSS（`grep -oP 'class=["\'][^"\']*\b类名\b[^"\']*["\'][^>]*>.{0,120}'`），按语义给色（红=危险/停，黄=警告/待办，绿=通过/保留，蓝=信息，灰=中性）。纯修饰类（如 group-section）可以不处理，但要在审计脚本里显式豁免并注明原因。

### 4.3 🟢【照做】结构问题扫描（文本墙/裸链接/失效锚点/残留 Markdown/缺脚本）

```python
import re, pathlib
for f in sorted(pathlib.Path('reports').glob('*.html')):
    src = f.read_text()
    m = re.search(r'<main id="content" class="wf-content">(.*?)</main>', src, re.S)
    if not m: continue
    body = m.group(1); issues = []
    if re.search(r'<pre>[^<]*##', body): issues.append('残留markdown')
    walls = [t for t in re.findall(r'<(?:td|p|li)[^>]*>([^<>]{100,})<', body) if t.count('；') >= 2]
    if walls: issues.append(f'文本墙x{len(walls)}')
    if re.findall(r'</a>\s*<br\s*/?>\s*<a ', body): issues.append('br堆叠链接')
    ids = set(re.findall(r'''id=["']([^"']+)["']''', src))
    dead = [h for h in re.findall(r'''href=["']#([^"']+)["']''', src) if h not in ids]
    if dead: issues.append(f'失效锚点{sorted(set(dead))[:3]}')
    if re.search(r'<(input|button|select)', body) and '<script' not in body:
        issues.append('有交互控件但无脚本')
    if issues: print(f.name, issues)
```

🟡【需判断】扫出来的不全是问题：帮助页里带"；"的说明段落是正常散文，不是表格文本墙——要打开看一眼再定。**误报要豁免并注明，不要为了审计清零去改正常内容。**

### 4.4 🟢【照做】功能回归（有交互的页面）

改动后逐项 grep 确认：状态 JS 还在（`'wf2:'+id`）、行数没变（`data-task-id` 计数）、进度条标记还在。把期望值写死在检查命令里（如 178、20），数字对不上就是出事了。

**完成标准**：4.1~4.4 全部通过或有注明的豁免；审计结果写进交付汇报。

---

## 第 5 阶段：交付（提交 → PR → 合并 → 部署验证）

### 5.1 🟢【照做】提交与 PR

- commit message：一句话结论 + 要点列表（改了什么、为什么）
- 推送后开 **draft PR**，PR 描述含：背景 / 改动 / 验证结果（贴第 4 阶段审计结论）
- 提交前 `git status` 检查没把垃圾带进来（`__pycache__`、临时文件）；带进来了就 `git rm --cached` + 补 `.gitignore`

### 5.2 🟡【需判断】合并冲突处理（本项目踩过的坑，重点看）

squash 合并会让分支与 main 历史分叉，下次合并必冲突。处理流程：
1. `git fetch origin main && git merge origin/main`
2. `git status --short | grep '^UU'` 列出**所有**冲突文件——**有几个处理几个，不要处理了一个就 add -A 提交**
3. 判断保留哪侧：如果分支是 main 的超集（main 上没有别人新提交），全部 `git checkout --ours`；否则逐文件看
4. 提交前必查：`grep -rl '<<<<<<<' .` 必须为空
5. 推送后**再跑一次 4.4 功能回归**（冲突解决最容易悄悄破坏功能）

### 5.3 🟢【照做】部署验证（不查到结果不许说"部署完成"）

1. 合并 PR（用户确认后）
2. 查生产部署状态直到 `state=READY` 且 commit SHA = 刚才的合并 commit
3. 汇报里写明：部署 ID、对应 commit、线上地址
4. 状态是 BUILDING 就明说"还在构建"，查不到就明说"未确认"

**完成标准**：汇报里的每个状态结论都有实查证据。

---

## 第 6 阶段：交付汇报模板 🟢【照做】

```
✅ <一句话结论>（含实查证据，如"部署 READY，commit abc1234"）

## 改了什么
<按用户的原始诉求分点，每点一两句>

## 我做的判断（用户没明说、我自己定的）
<列出取舍和理由，如"工作台与执行中心重叠，我选择降级工作台，因为……">

## 审计结果
<4.1~4.4 的结论，含豁免项及原因>

## 遗留/不确定
<明确说"不确定"的事项；没有就写"无">

## 下一步
<给用户的最短验收路径：先点哪、看什么>
```

---

## 附：哪里最容易翻车（按本项目实际事故）

| 事故 | 根因 | 防呆 |
|---|---|---|
| 冲突标记被推上线 | 两个冲突文件只处理了一个就 `add -A` | 5.2 第 2、4 步 |
| 整页 Markdown 没渲染 | 没人打开看过那页 | 4.3 的 `<pre>` 扫描 |
| 状态标签全部无色 | 统一壳剥掉了页面原 CSS | 4.2 孤儿类审计 |
| 垃圾文件入库 | 提交时没看 status | 5.1 |
| "盯着 CI"却没下文 | webhook 不推成功事件 | 5.3 主动轮询 |
