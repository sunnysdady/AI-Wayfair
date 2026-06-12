from __future__ import annotations

from pathlib import Path


def require_files(paths: list[Path], *, root: Path, context: str) -> None:
    missing = [path for path in paths if not path.exists()]
    if not missing:
        return

    rel = [str(path.relative_to(root)) if path.is_relative_to(root) else str(path) for path in missing]
    lines = [
        f"{context} 缺少输入文件：",
        *[f"- {item}" for item in rel],
        "",
        "请把原始导出文件放到 data/raw/；该目录按数据安全规则不会提交到仓库。",
    ]
    raise SystemExit("\n".join(lines))
