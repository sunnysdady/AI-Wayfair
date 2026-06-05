from __future__ import annotations

import unittest

import build_ops_workbench as ops


class OpsWorkbenchRulesTest(unittest.TestCase):
    def test_priority_sort_order(self) -> None:
        rows = [
            {"优先级": "P2", "排序分": 20, "任务ID": "T-003"},
            {"优先级": "P0", "排序分": 90, "任务ID": "T-001"},
            {"优先级": "P1", "排序分": 60, "任务ID": "T-002"},
        ]
        ordered = ops.sort_tasks(rows)
        self.assertEqual([r["任务ID"] for r in ordered], ["T-001", "T-002", "T-003"])

    def test_task_id_is_stable(self) -> None:
        task_id = ops.make_task_id("MFC-D3-B", "定价", 1)
        self.assertEqual(task_id, "TASK-MFC-D3-B-PRICING-001")

    def test_pricing_task_for_no_raise_group(self) -> None:
        row = {
            "供应商SKU": "MFC-D3-B",
            "Wayfair Listing": "DMOM1022",
            "中文名": "3抽鹅颈活动柜黑色",
            "SKU价值分层": "B",
            "促销准入": "禁止促销/先修复",
            "定价分组": "不建议提价",
            "主要问题": "Base/前台价高于72%；大促2B利润率低于12%",
            "建议动作": "不要先提Base；禁止深折扣促销",
        }
        tasks = ops.pricing_tasks(row)
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["优先级"], "P0")
        self.assertEqual(tasks[0]["问题类型"], "定价")
        self.assertIn("不要先提Base", tasks[0]["建议动作"])

    def test_required_task_columns(self) -> None:
        self.assertEqual(ops.TASK_COLUMNS, [
            "任务ID",
            "优先级",
            "任务状态",
            "问题类型",
            "供应商SKU",
            "Wayfair Listing",
            "产品名",
            "SKU价值分层",
            "促销准入",
            "触发原因",
            "建议动作",
            "执行前检查",
            "复盘指标",
            "证据来源",
            "证据链接",
            "排序分",
        ])


if __name__ == "__main__":
    unittest.main()
