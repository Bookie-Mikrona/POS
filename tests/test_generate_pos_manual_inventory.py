from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "manual_inventory", ROOT / "scripts/generate_pos_manual_inventory.py"
)
assert SPEC and SPEC.loader
inventory = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inventory)


def test_export_date_does_not_claim_old_rows_were_reviewed_again() -> None:
    rows = inventory.load_rows()
    old = next(row for row in rows if not row.get("reviewed_on"))
    current = next(row for row in rows if row.get("reviewed_on") == "2026-10-10")
    assert inventory.row_values(old)[-1] == "05.10.2026"
    assert inventory.row_values(current)[-1] == "10.10.2026"
    assert inventory.REVIEW_DATE.strftime("%d.%m.%Y") == "10.10.2026"


def test_inventory_has_unique_ids_and_existing_evidence_paths() -> None:
    rows = inventory.load_rows()
    identifiers = [row["id"] for row in rows]
    assert len(identifiers) == len(set(identifiers))
    for row in rows:
        for field in ("ui_evidence", "api_evidence", "manual_evidence"):
            assert row[field], (row["id"], field)
            for reference in row[field]:
                path = reference.split(":", 1)[0].split(" — ", 1)[0]
                assert (ROOT / path).exists(), (row["id"], field, reference)


def test_new_workflows_are_documented_without_claiming_hardware_test() -> None:
    rows = {row["id"]: row for row in inventory.load_rows()}
    for identifier in ("UNIT-FUNCTION-POLICY", "DI-SELECTIVE-IMPORT",
                       "MAIL-BUSINESS-IDENTITY", "VIVA-BRIDGE-INSTALL"):
        assert rows[identifier]["reviewed_on"] == "2026-10-10"
        assert rows[identifier]["implementation_status"] == "IMPLEMENTIRANO"
        assert rows[identifier]["coverage_status"] == "PRAVILNO"
    assert "nista ponovno testirani" in rows["VIVA-BRIDGE-INSTALL"]["gap_or_correction"]
