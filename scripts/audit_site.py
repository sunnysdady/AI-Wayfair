"""全站审计：链接 / 孤儿样式类 / 结构问题 / 功能回归。任何一项失败则非零退出。

对应 SOP 第 4 阶段。豁免项需在 EXEMPT_* 常量里登记并注明原因。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"

# 豁免清单（必须写原因）
EXEMPT_ORPHAN_CLASSES = {"group-section"}  # 纯锚点修饰类，样式由 .section 提供
EXEMPT_WALL_PAGES = {"Wayfair_帮助中心.html"}  # 帮助条目是说明散文，不是表格文本墙

# 独立工具页：apply_dashboard_shell 的跳过清单同款，不套壳所以不做正文类检查
STANDALONE_PAGES = ("每日库存生成工具",)

# 功能回归期望值（任务清单重新生成时更新这里）
EXPECT_TASK_ROWS = {"Wayfair_SKU任务清单": 179, "Wayfair_运营执行中心": 20}

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print("FAIL:", msg)


def all_pages() -> list[Path]:
    return [ROOT / "index.html", *sorted(REPORTS.glob("*.html")), *sorted((REPORTS / "archive").glob("*.html"))]


def check_links() -> None:
    for f in all_pages():
        for href in re.findall(r"""href=["']([^"'#][^"']*)["']""", f.read_text()):
            if href.startswith(("http", "mailto", "data:")):
                continue
            if not (f.parent / href.split("#")[0]).resolve().exists():
                fail(f"断链 {f.name} -> {href}")


def content_of(src: str) -> str | None:
    m = re.search(r'<(?:main|div) id="content" class="wf-content">(.*?)</(?:main|div)>\s*</main>', src, re.S)
    return m.group(1) if m else None


def check_orphan_classes() -> None:
    css = (REPORTS / "assets" / "dashboard-shell.css").read_text()
    defined = set(re.findall(r"\.([A-Za-z][\w-]*)", css))
    for f in sorted(REPORTS.glob("*.html")):
        if any(key in f.name for key in STANDALONE_PAGES):
            continue
        body = content_of(f.read_text())
        if body is None:
            fail(f"无法提取正文 {f.name}")
            continue
        inline = set(re.findall(r"\.([A-Za-z][\w-]*)", " ".join(re.findall(r"<style>(.*?)</style>", body, re.S))))
        orphans = {
            c
            for attr in re.findall(r"""class=["']([^"']+)["']""", body)
            for c in attr.split()
            if c not in defined and c not in inline and c not in EXEMPT_ORPHAN_CLASSES
        }
        if orphans:
            fail(f"孤儿样式类 {f.name}: {sorted(orphans)}")


def check_structure() -> None:
    for f in sorted(REPORTS.glob("*.html")):
        if any(key in f.name for key in STANDALONE_PAGES):
            continue
        src = f.read_text()
        body = content_of(src)
        if body is None:
            continue
        if re.search(r"<pre>[^<]*##", body):
            fail(f"残留markdown {f.name}")
        if f.name not in EXEMPT_WALL_PAGES:
            walls = [t for t in re.findall(r"<(?:td|p|li)[^>]*>([^<>]{100,})<", body) if t.count("；") >= 2]
            if walls:
                fail(f"文本墙x{len(walls)} {f.name}")
        if re.findall(r"</a>\s*<br\s*/?>\s*<a ", body):
            fail(f"br堆叠链接 {f.name}")
        ids = set(re.findall(r"""id=["']([^"']+)["']""", src))
        dead = [h for h in re.findall(r"""href=["']#([^"']+)["']""", src) if h not in ids]
        if dead:
            fail(f"失效锚点 {f.name}: {sorted(set(dead))[:3]}")
        if "<<<<<<<" in src and f.suffix == ".html":
            fail(f"冲突标记 {f.name}")
        if re.search(r'<main id="content"', src):
            fail(f"嵌套main残留 {f.name}")


def check_visual_rules() -> None:
    css = (REPORTS / "assets" / "dashboard-shell.css").read_text()
    if re.search(r"\.wf-content\s+\.bar\s*\{[^}]*position\s*:\s*absolute", css):
        fail("全局 .wf-content .bar 规则会污染甘特图，应限定到 .wf-content .lane>.bar")
    if ".wf-content .lane>.bar" not in css:
        fail("缺少进度条限定样式 .wf-content .lane>.bar")
    for f in sorted(REPORTS.glob("*甘特图*.html")):
        src = f.read_text()
        if "wf-data-alert" not in src:
            fail(f"甘特图缺少数据新鲜度提醒 {f.name}")


# 数据新鲜度提醒只要求出现在决策页（与 apply_dashboard_shell.needs_data_alert 保持一致）
DATA_ALERT_PAGES = ("运营执行中心", "SKU任务清单", "数据补齐", "甘特图")


def check_data_freshness_notice() -> None:
    for f in sorted(REPORTS.glob("*.html")):
        if not any(key in f.name for key in DATA_ALERT_PAGES):
            continue
        src = f.read_text()
        if "wf-data-alert" not in src:
            fail(f"缺少数据新鲜度提醒 {f.name}")
        if "2026-06-06 至 2026-06-12" not in src:
            fail(f"缺少本周需补数据区间 {f.name}")


def check_regression() -> None:
    for prefix, expect in EXPECT_TASK_ROWS.items():
        matches = sorted(REPORTS.glob(f"{prefix}_*.html"))
        if not matches:
            fail(f"找不到 {prefix} 页面")
            continue
        src = matches[-1].read_text()
        n = src.count("data-task-id='TASK-") + src.count('data-task-id="TASK-')
        if n != expect:
            fail(f"{matches[-1].name} 任务行数 {n} != 期望 {expect}")
        if "task-state.js" not in src or "WF_TASKS_GEN" not in src:
            fail(f"{matches[-1].name} 缺少共享状态脚本/版本戳")
    if not (REPORTS / "assets" / "task-state.js").exists():
        fail("assets/task-state.js 不存在")


def main() -> None:
    check_links()
    check_orphan_classes()
    check_structure()
    check_visual_rules()
    check_data_freshness_notice()
    check_regression()
    if failures:
        sys.exit(f"审计失败：{len(failures)} 项")
    print("审计全部通过")


if __name__ == "__main__":
    main()
