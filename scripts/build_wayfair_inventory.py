from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Iterable

import pandas as pd


CSV_ENCODINGS = ("utf-8-sig", "utf-8", "gb18030")


def text(value) -> str:
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except TypeError:
        pass
    return str(value).strip()


def norm_key(value) -> str:
    return text(value).upper()


def norm_col(value) -> str:
    return re.sub(r"[\s_/#\\-]+", "", text(value)).lower()


def read_csv_auto(path: Path) -> pd.DataFrame:
    last_error: Exception | None = None
    for encoding in CSV_ENCODINGS:
        try:
            return pd.read_csv(path, encoding=encoding, low_memory=False)
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"Cannot read CSV {path}: {last_error}")


def find_column(df: pd.DataFrame, candidates: Iterable[str], label: str, explicit: str | None = None) -> str:
    if explicit:
        if explicit not in df.columns:
            raise ValueError(f"{label} column not found: {explicit}")
        return explicit

    normalized = {norm_col(col): col for col in df.columns}
    for candidate in candidates:
        col = normalized.get(norm_col(candidate))
        if col is not None:
            return col
    raise ValueError(f"Cannot detect {label} column. Available columns: {list(df.columns)}")


def split_mapped_skus(value) -> list[str]:
    raw = text(value)
    if not raw:
        return []
    parts = re.split(r"[,，;；\n\r]+", raw)
    return [norm_key(part) for part in parts if text(part)]


def clean_supplier_id(value) -> str:
    raw = text(value)
    if not raw:
        return ""
    try:
        number = float(raw)
        if number.is_integer():
            return str(int(number))
    except ValueError:
        pass
    return raw


def read_mapping_workbook(
    path: Path,
    sku_sheet: str | None = None,
    warehouse_sheet: str | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    xl = pd.ExcelFile(path)
    sku_sheet_name = sku_sheet or next((s for s in xl.sheet_names if "SKU" in s.upper()), xl.sheet_names[0])
    wh_sheet_name = warehouse_sheet or next((s for s in xl.sheet_names if "仓库" in s), xl.sheet_names[-1])
    return (
        pd.read_excel(path, sheet_name=sku_sheet_name),
        pd.read_excel(path, sheet_name=wh_sheet_name),
    )


def build_sku_map(df: pd.DataFrame, wayfair_col: str | None = None, lingxing_col: str | None = None) -> dict[str, list[str]]:
    wayfair = find_column(
        df,
        ["Supplier Part#", "Supplier Part Number", "Wayfair SKU", "Wayfair供应商SKU", "供应商SKU"],
        "Wayfair SKU mapping",
        wayfair_col,
    )
    lingxing = find_column(df, ["领星SKU", "SKU", "SKU编码", "Lingxing SKU"], "Lingxing SKU mapping", lingxing_col)

    mapping: dict[str, list[str]] = {}
    for _, row in df.dropna(how="all").iterrows():
        key = norm_key(row.get(wayfair))
        if not key:
            continue
        values = split_mapped_skus(row.get(lingxing))
        if not values:
            continue
        mapping.setdefault(key, [])
        for value in values:
            if value not in mapping[key]:
                mapping[key].append(value)
    return mapping


def build_warehouse_map(df: pd.DataFrame, supplier_id_col: str | None = None, warehouse_col: str | None = None) -> dict[str, str]:
    supplier_id = find_column(
        df,
        ["云仓仓库ID", "Supplier ID", "Warehouse ID", "Wayfair仓库ID"],
        "Wayfair supplier id mapping",
        supplier_id_col,
    )
    warehouse = find_column(df, ["BZ领星仓库", "领星仓库", "仓库", "Warehouse"], "Lingxing warehouse mapping", warehouse_col)

    mapping: dict[str, str] = {}
    for _, row in df.dropna(how="all").iterrows():
        key = clean_supplier_id(row.get(supplier_id))
        value = text(row.get(warehouse))
        if key and value:
            mapping[key] = value
    return mapping


def build_inventory_lookup(
    df: pd.DataFrame,
    sku_col: str | None = None,
    warehouse_col: str | None = None,
    qty_col: str | None = None,
) -> dict[tuple[str, str], int]:
    sku = find_column(df, ["SKU", "领星SKU", "MSKU"], "inventory SKU", sku_col)
    warehouse = find_column(df, ["仓库", "领星仓库", "Warehouse"], "inventory warehouse", warehouse_col)
    qty = find_column(df, ["可用量", "可售库存", "可用库存", "库存数量", "Available"], "inventory quantity", qty_col)

    working = df[[sku, warehouse, qty]].copy()
    working[sku] = working[sku].map(norm_key)
    working[warehouse] = working[warehouse].map(text)
    working[qty] = pd.to_numeric(working[qty], errors="coerce").fillna(0)
    working = working[(working[sku] != "") & (working[warehouse] != "")]

    grouped = working.groupby([sku, warehouse], dropna=False)[qty].sum()
    return {
        (sku_value, warehouse_value): max(int(qty_value), 0)
        for (sku_value, warehouse_value), qty_value in grouped.items()
    }


def resolve_quantity(mapped_skus: list[str], warehouse: str, lookup: dict[tuple[str, str], int]) -> int:
    return sum(lookup.get((sku, warehouse), 0) for sku in mapped_skus)


def build_wayfair_inventory(
    template: pd.DataFrame,
    sku_map: dict[str, list[str]],
    warehouse_map: dict[str, str],
    inventory_lookup: dict[tuple[str, str], int],
    supplier_id_col: str | None = None,
    template_sku_col: str | None = None,
    template_qty_col: str | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, int]]:
    supplier_id = find_column(template, ["Supplier ID", "Warehouse ID"], "template supplier id", supplier_id_col)
    template_sku = find_column(
        template,
        ["Supplier Part#", "Supplier Part Number", "Wayfair SKU", "供应商SKU"],
        "template Wayfair SKU",
        template_sku_col,
    )
    template_qty = find_column(template, ["In Stock", "Quantity", "库存"], "template quantity", template_qty_col)

    output = template.copy()
    audit_rows: list[dict[str, object]] = []
    quantities: list[int] = []

    for _, row in template.iterrows():
        supplier_key = clean_supplier_id(row.get(supplier_id))
        wayfair_sku = norm_key(row.get(template_sku))
        warehouse = warehouse_map.get(supplier_key, "")
        mapped_skus = sku_map.get(wayfair_sku, [])

        if not mapped_skus and not warehouse:
            status = "MISSING_SKU_AND_WAREHOUSE_MAPPING"
            qty = 0
        elif not mapped_skus:
            status = "MISSING_SKU_MAPPING"
            qty = 0
        elif not warehouse:
            status = "MISSING_WAREHOUSE_MAPPING"
            qty = 0
        else:
            qty = resolve_quantity(mapped_skus, warehouse, inventory_lookup)
            status = "OK" if qty > 0 or any((sku, warehouse) in inventory_lookup for sku in mapped_skus) else "MISSING_INVENTORY"

        quantities.append(qty)
        audit_rows.append({
            "Supplier ID": supplier_key,
            "Supplier Part#": text(row.get(template_sku)),
            "Lingxing Warehouse": warehouse,
            "Lingxing SKU": ";".join(mapped_skus),
            "Output In Stock": qty,
            "Status": status,
        })

    output[template_qty] = quantities
    audit = pd.DataFrame(audit_rows)
    summary = {
        "template_rows": int(len(template)),
        "output_total_in_stock": int(sum(quantities)),
        "ok_rows": int((audit["Status"] == "OK").sum()),
        "missing_sku_mapping_rows": int((audit["Status"] == "MISSING_SKU_MAPPING").sum()),
        "missing_warehouse_mapping_rows": int((audit["Status"] == "MISSING_WAREHOUSE_MAPPING").sum()),
        "missing_both_mapping_rows": int((audit["Status"] == "MISSING_SKU_AND_WAREHOUSE_MAPPING").sum()),
        "missing_inventory_rows": int((audit["Status"] == "MISSING_INVENTORY").sum()),
    }
    return output, audit, summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build Wayfair daily inventory CSV from Lingxing inventory and mapping workbook.")
    parser.add_argument("--template", required=True, type=Path, help="Wayfair inventory CSV template.")
    parser.add_argument("--mapping", required=True, type=Path, help="Mapping workbook with SKU and warehouse sheets.")
    parser.add_argument("--lingxing", required=True, type=Path, help="Lingxing overseas warehouse inventory detail workbook.")
    parser.add_argument("--output", required=True, type=Path, help="Generated Wayfair inventory CSV.")
    parser.add_argument("--audit-output", type=Path, help="Row-level audit CSV.")
    parser.add_argument("--issues-output", type=Path, help="Deduplicated non-OK rows for mapping/data follow-up.")
    parser.add_argument("--summary-output", type=Path, help="JSON summary path.")
    parser.add_argument("--sku-sheet", help="Mapping workbook SKU sheet name.")
    parser.add_argument("--warehouse-sheet", help="Mapping workbook warehouse sheet name.")
    parser.add_argument("--template-supplier-id-col")
    parser.add_argument("--template-sku-col")
    parser.add_argument("--template-qty-col")
    parser.add_argument("--mapping-wayfair-col")
    parser.add_argument("--mapping-lingxing-col")
    parser.add_argument("--warehouse-supplier-id-col")
    parser.add_argument("--warehouse-lingxing-col")
    parser.add_argument("--inventory-sku-col")
    parser.add_argument("--inventory-warehouse-col")
    parser.add_argument("--inventory-qty-col")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    template = read_csv_auto(args.template)
    sku_sheet, warehouse_sheet = read_mapping_workbook(args.mapping, args.sku_sheet, args.warehouse_sheet)
    lingxing = pd.read_excel(args.lingxing)

    sku_map = build_sku_map(sku_sheet, args.mapping_wayfair_col, args.mapping_lingxing_col)
    warehouse_map = build_warehouse_map(warehouse_sheet, args.warehouse_supplier_id_col, args.warehouse_lingxing_col)
    inventory_lookup = build_inventory_lookup(
        lingxing,
        args.inventory_sku_col,
        args.inventory_warehouse_col,
        args.inventory_qty_col,
    )
    output, audit, summary = build_wayfair_inventory(
        template,
        sku_map,
        warehouse_map,
        inventory_lookup,
        args.template_supplier_id_col,
        args.template_sku_col,
        args.template_qty_col,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(args.output, index=False, encoding="utf-8-sig")

    if args.audit_output:
        args.audit_output.parent.mkdir(parents=True, exist_ok=True)
        audit.to_csv(args.audit_output, index=False, encoding="utf-8-sig")

    if args.issues_output:
        args.issues_output.parent.mkdir(parents=True, exist_ok=True)
        issues = audit[audit["Status"] != "OK"].drop_duplicates()
        issues.to_csv(args.issues_output, index=False, encoding="utf-8-sig")

    summary.update({
        "output": str(args.output),
        "audit_output": str(args.audit_output) if args.audit_output else "",
        "issues_output": str(args.issues_output) if args.issues_output else "",
    })
    if args.summary_output:
        args.summary_output.parent.mkdir(parents=True, exist_ok=True)
        args.summary_output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
