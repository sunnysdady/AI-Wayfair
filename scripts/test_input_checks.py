from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from input_checks import require_files


class InputChecksTest(unittest.TestCase):
    def test_missing_files_report_relative_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            missing = root / "data" / "raw" / "missing.csv"
            with self.assertRaises(SystemExit) as cm:
                require_files([missing], root=root, context="测试")

        msg = str(cm.exception)
        self.assertIn("测试 缺少输入文件", msg)
        self.assertIn("data/raw/missing.csv", msg)
        self.assertIn("data/raw/", msg)

    def test_existing_files_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            existing = root / "ok.csv"
            existing.write_text("ok", encoding="utf-8")
            require_files([existing], root=root, context="测试")


if __name__ == "__main__":
    unittest.main()
