from __future__ import annotations

import re
import sys
from pathlib import Path


def find_repo_root() -> Path:
    start = Path.cwd()
    for path in [start, *start.parents]:
        if (path / "reports").is_dir() and (path / ".git").exists():
            return path
    return Path(__file__).resolve().parents[1]


ROOT = find_repo_root()
REPORTS = ROOT / "reports"

TASK_PAGES = [
    "Wayfair_SKU任务清单_20260605.html",
    "Wayfair_运营执行中心_20260605.html",
]
WALL_PAGES = {
    "Wayfair_SKU经营档案_20260605.html": r"(<p>)\s*([^<>]{60,})\s*(</p>)",
    "Wayfair_6月SKU分层与促销准入清单_20260604.html": r"(<td>)\s*([^<>]{60,})\s*(</td>)",
}


def split_clauses(text: str) -> list[str]:
    return [c.strip().rstrip("。") for c in text.split("；") if c.strip()]


def clause_block(clauses: list[str], visible: int, lead: str | None = None) -> str:
    out = ""
    if lead:
        out += f"<b class='lead'>{lead}</b>"
    head, rest = clauses[:visible], clauses[visible:]
    if head:
        out += "<ul class='clause-list'>" + "".join(f"<li>{c}</li>" for c in head) + "</ul>"
    if rest:
        items = "".join(f"<li>{c}</li>" for c in rest)
        out += (f"<details class='clause-more'><summary>更多 ({len(rest)})</summary>"
                f"<ul class='clause-list'>{items}</ul></details>")
    return out


def tidy_trigger(m: re.Match) -> str:
    clauses = split_clauses(m.group(1))
    if len(clauses) < 2:
        return m.group(0)
    lead = None
    first = clauses[0]
    if "：" in first and first.index("：") <= 12:
        lead, remainder = first.split("：", 1)
        clauses = ([remainder] if remainder.strip() else []) + clauses[1:]
    return "<td>" + clause_block(clauses, 2, lead) + "</td>"


def tidy_action(m: re.Match) -> str:
    clauses = split_clauses(m.group(1))
    if len(clauses) < 2:
        return m.group(0)
    return clause_block(clauses[1:], 1, clauses[0])


def tidy_wall(m: re.Match) -> str:
    clauses = split_clauses(m.group(2))
    if len(clauses) < 3:
        return m.group(0)
    open_tag, close_tag = m.group(1), m.group(3)
    if open_tag == "<p>":  # a <ul> may not live inside <p>
        open_tag, close_tag = "<div class='clause-wrap'>", "</div>"
    return open_tag + clause_block(clauses, 3) + close_tag


def tidy_task_page(path: Path) -> None:
    src = path.read_text(encoding="utf-8")

    src = re.sub(r"<div class='small'>TASK-[^<]*</div>", "", src)

    src = re.sub(r"<td><div class='lc4'>([^<>]+)</div></td>", tidy_trigger, src)
    src = re.sub(r"<b class='lc3'>([^<>]+)</b>", tidy_action, src)

    src = re.sub(
        r"<div class='lc3'>下次复盘看：([^<>]+?)。?</div>",
        r"<div class='small kpi-note'>复盘：\1</div>",
        src,
    )

    src = src.replace("执行状态（点击切换）", "执行状态")
    src = src.replace("类型 / 状态（点击切换）", "类型 / 状态")
    src = src.replace("border:1px dashed currentColor", "border:1px solid rgba(21,32,51,.14)")

    path.write_text(src, encoding="utf-8")
    print(f"tidied task page: {path.name}")


def tidy_wall_page(path: Path, pattern: str) -> None:
    src = path.read_text(encoding="utf-8")
    src, n = re.subn(pattern, tidy_wall, src)
    path.write_text(src, encoding="utf-8")
    print(f"tidied {n} text walls: {path.name}")


def main() -> None:
    if not REPORTS.exists():
        print(f"reports not found: {REPORTS}", file=sys.stderr)
        sys.exit(1)
    for name in TASK_PAGES:
        tidy_task_page(REPORTS / name)
    for name, pattern in WALL_PAGES.items():
        tidy_wall_page(REPORTS / name, pattern)


if __name__ == "__main__":
    main()
