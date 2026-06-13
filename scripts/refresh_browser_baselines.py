"""把浏览器端分析引擎的基准输入从 data/ 同步到部署可访问的 assets。

浏览器跑 Pyodide 分析时需要 3 个基准 CSV，但 data/ 和 *.csv 都不部署到线上，
所以镜像成 reports/assets/baseline/*.csv.txt（.txt 规避 *.csv 忽略）。
放进 build_all，数据每次重建时基准自动刷新，避免静默过期。
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DEST = ROOT / "reports" / "assets" / "baseline"

# data 源文件 -> assets 目标名（与 analysis-engine.js 的 BASELINES 路径一一对应）
MAP = {
    "Wayfair_Pricing_ProductCatalog_定价体检_20260604.csv": "pricing_catalog.csv.txt",
    "Wayfair_SKU价值分级_补齐版_20260604.csv": "sku_score.csv.txt",
    "Wayfair_库存映射对照_20260604.csv": "inventory_map.csv.txt",
}


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    missing = []
    for src_name, dst_name in MAP.items():
        src = DATA / src_name
        if not src.exists():
            missing.append(src_name)
            continue
        shutil.copyfile(src, DEST / dst_name)
    if missing:
        print(f"refresh_browser_baselines: 缺少基准源 {missing}", file=sys.stderr)
        sys.exit(1)
    print(f"browser baselines refreshed ({len(MAP)} files)")


if __name__ == "__main__":
    main()
