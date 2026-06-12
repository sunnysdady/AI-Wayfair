#!/usr/bin/env bash
# 一键流水线：内容整理 -> 统一壳 -> 全站审计（任何一步失败即停止）
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/tidy_report_tables.py
python3 scripts/apply_dashboard_shell.py
python3 scripts/audit_site.py
echo "build_all OK"
