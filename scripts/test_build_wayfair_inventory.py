from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_wayfair_inventory as inv


class WayfairInventoryBuilderTest(unittest.TestCase):
    def test_build_inventory_uses_template_rows_and_warehouse_mapping(self) -> None:
        template = pd.DataFrame([
            {"Supplier ID": 1001, "Supplier Part#": "WF-A", "In Stock": 0, "Product": "A"},
            {"Supplier ID": 1002, "Supplier Part#": "WF-A", "In Stock": 0, "Product": "A"},
            {"Supplier ID": 1001, "Supplier Part#": "WF-NO-MAP", "In Stock": 8, "Product": "Tail"},
        ])
        sku_map = {"WF-A": ["LX-A"]}
        warehouse_map = {"1001": "LA", "1002": "GA"}
        inventory_lookup = {("LX-A", "LA"): 3, ("LX-A", "GA"): 9}

        output, audit, summary = inv.build_wayfair_inventory(template, sku_map, warehouse_map, inventory_lookup)

        self.assertEqual(output["Supplier Part#"].tolist(), ["WF-A", "WF-A", "WF-NO-MAP"])
        self.assertEqual(output["In Stock"].tolist(), [3, 9, 0])
        self.assertEqual(output["Product"].tolist(), ["A", "A", "Tail"])
        self.assertEqual(audit["Status"].tolist(), ["OK", "OK", "MISSING_SKU_MAPPING"])
        self.assertEqual(summary["missing_sku_mapping_rows"], 1)

    def test_inventory_lookup_sums_duplicate_sku_warehouse_rows(self) -> None:
        inventory = pd.DataFrame([
            {"SKU": "LX-A", "仓库": "LA", "可用量": 4},
            {"SKU": "LX-A", "仓库": "LA", "可用量": 6},
            {"SKU": "LX-A", "仓库": "GA", "可用量": 7},
        ])

        lookup = inv.build_inventory_lookup(inventory)

        self.assertEqual(lookup[("LX-A", "LA")], 10)
        self.assertEqual(lookup[("LX-A", "GA")], 7)

    def test_multiple_lingxing_skus_are_added_for_one_wayfair_sku(self) -> None:
        mapping = pd.DataFrame([{"Supplier Part#": "WF-BUNDLE", "领星SKU": "LX-1; LX-2"}])
        sku_map = inv.build_sku_map(mapping)

        template = pd.DataFrame([{"Supplier ID": 1001, "Supplier Part#": "WF-BUNDLE", "In Stock": 0}])
        output, _, _ = inv.build_wayfair_inventory(
            template,
            sku_map,
            {"1001": "LA"},
            {("LX-1", "LA"): 2, ("LX-2", "LA"): 5},
        )

        self.assertEqual(output.loc[0, "In Stock"], 7)


if __name__ == "__main__":
    unittest.main()
