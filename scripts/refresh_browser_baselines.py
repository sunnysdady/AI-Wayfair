"""把浏览器端引擎需要的基线数据从 data/ 同步到部署可访问的 assets。

周复盘自助工具在浏览器里需要库存映射(SKU 映射 + 可用量)，但 data/ 和 *.csv
都不部署，故镜像成 reports/assets/baseline/*.csv.txt（.txt 规避 *.csv 忽略）。
接入 build_all，数据每次重建自动刷新，避免静默过期。
"""
from __future__ import annotations
import shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DEST = ROOT / "reports" / "assets" / "baseline"
MAP = {"Wayfair_库存映射对照_20260604.csv": "inventory_map.csv.txt"}


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    missing = []
    for src_name, dst_name in MAP.items():
        src = DATA / src_name
        if not src.exists():
            missing.append(src_name); continue
        shutil.copyfile(src, DEST / dst_name)
    if missing:
        print(f"refresh_browser_baselines: 缺少基线源 {missing}", file=sys.stderr); sys.exit(1)
    print(f"browser baselines refreshed ({len(MAP)} files)")


if __name__ == "__main__":
    main()
