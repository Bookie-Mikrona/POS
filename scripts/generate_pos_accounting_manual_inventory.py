#!/usr/bin/env python3
"""Generate the POS Gostinstvo accounting-manual traceability outputs."""

from datetime import date
from pathlib import Path

import generate_pos_manual_inventory as base


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"


def main() -> None:
    base.CANONICAL_JSON = (
        DOCS / "POS-Gostinstvo-racunovodski-sledljiv-inventar.json"
    )
    base.CSV_OUTPUT = DOCS / "POS-Gostinstvo-racunovodski-sledljiv-inventar.csv"
    base.XLSX_OUTPUT = DOCS / "POS-Gostinstvo-racunovodski-sledljiv-inventar.xlsx"
    base.MD_OUTPUT = DOCS / "POS-Gostinstvo-racunovodski-sledljiv-inventar.md"
    base.REVIEW_DATE = date(2026, 10, 10)
    base.BASELINE_REVIEW_DATE = date(2026, 9, 21)
    base.REVIEW_REPORT = "pos-accounting-manual-src/00-uvod-in-delo-s-temeljnicami.md"
    base.INVENTORY_TITLE = (
        "POS Gostinstvo — sledljiv inventar računovodskega priročnika"
    )

    rows = base.load_rows()
    base.write_csv(rows)
    base.write_markdown(rows)
    base.write_workbook(rows)
    print(f"{len(rows)} računovodskih postopkov")
    print(base.CANONICAL_JSON)
    print(base.CSV_OUTPUT)
    print(base.XLSX_OUTPUT)
    print(base.MD_OUTPUT)


if __name__ == "__main__":
    main()