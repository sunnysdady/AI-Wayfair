from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
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

    def test_store_priority_demotes_tail_without_sales(self) -> None:
        priority, _ = ops.store_priority({
            "SKU价值分层": "N",
            "5月订单数": 0,
            "YB历史订单数": 0,
            "5月回款额": 0,
            "YB历史回款额": 0,
            "5月毛利": 0,
            "YB历史毛利": 0,
            "平台空间率": 0.22,
            "当前Base预估毛利率": 0.25,
        }, [])
        self.assertEqual(priority, "P2")

    def test_store_priority_promotes_profitable_head_or_waist(self) -> None:
        priority, score = ops.store_priority({
            "SKU价值分层": "B",
            "5月订单数": 4,
            "YB历史订单数": 58,
            "5月回款额": 378,
            "YB历史回款额": 5060.2,
            "5月毛利": 83.32,
            "YB历史毛利": 812.588,
            "平台空间率": 0.183,
            "当前Base预估毛利率": 0.22,
            "库存状态": "库存可查",
            "促销准入": "禁止促销/先修复",
            "Listing问题": "",
        }, [{"问题类型": "定价"}])
        self.assertEqual(priority, "P0")
        self.assertGreater(score, 75)

    def test_detail_tasks_are_downgraded_by_store_value(self) -> None:
        import pandas as pd

        profiles = pd.DataFrame([{
            "供应商SKU": "TAIL-1",
            "SKU价值分层": "N",
            "5月订单数": 0,
            "YB历史订单数": 0,
            "5月回款额": 0,
            "YB历史回款额": 0,
            "5月毛利": 0,
            "YB历史毛利": 0,
            "平台空间率": 0.22,
            "当前Base预估毛利率": 0.25,
        }])
        tasks = pd.DataFrame([{
            "任务ID": "TASK-TAIL-1-PRICING-001",
            "优先级": "P0",
            "任务状态": "待执行",
            "问题类型": "定价",
            "供应商SKU": "TAIL-1",
            "Wayfair Listing": "",
            "产品名": "",
            "SKU价值分层": "N",
            "促销准入": "",
            "触发原因": "不建议提价",
            "建议动作": "不要先提Base",
            "执行前检查": "",
            "复盘指标": "",
            "证据来源": "",
            "证据链接": "",
            "排序分": 95,
        }])
        adjusted = ops.align_task_priorities_to_store_value(profiles, tasks)
        self.assertEqual(adjusted.iloc[0]["优先级"], "P2")
        self.assertIn("综合经营优先级为 P2", adjusted.iloc[0]["触发原因"])

    def test_store_action_plan_uses_specific_operating_lever(self) -> None:
        stock_action, stock_check, stock_metric = ops.store_action_plan({
            "库存状态": "库存不足",
            "总可售含在途": 0,
            "可用库存": 0,
            "促销准入": "禁止促销/先修复",
            "Listing问题": "",
            "客诉扣款记录数": 0,
            "广告花费": 0,
            "广告订单": 0,
            "ROAS": 0,
            "Base前台价比例": 0.70,
        }, "P0", {"platform_pct": 0.23, "est_margin": 0.24, "total_orders": 40, "profit": 1000})
        listing_action, listing_check, listing_metric = ops.store_action_plan({
            "库存状态": "库存可查",
            "总可售含在途": 80,
            "可用库存": 40,
            "促销准入": "准入",
            "Listing问题": "Required Tags 70%；Reviews 8",
            "客诉扣款记录数": 0,
            "广告花费": 0,
            "广告订单": 0,
            "ROAS": 0,
            "Base前台价比例": 0.68,
        }, "P0", {"platform_pct": 0.24, "est_margin": 0.25, "total_orders": 38, "profit": 950})

        self.assertIn("先锁库存", stock_action)
        self.assertIn("库存映射", stock_check)
        self.assertIn("缺货", stock_metric)
        self.assertIn("Listing", listing_action)
        self.assertIn("Required Tags", listing_check)
        self.assertNotEqual(stock_action, listing_action)

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
