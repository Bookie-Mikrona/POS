"""Prevent classifying company-level tax evidence as POS functionality."""

import json
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


def test_tax_procedures_only_belong_to_glavna_knjiga_inventory():
    for path in (
        "docs/POS-Gostinstvo-sledljiv-inventar.json",
        "docs/POS-Gostinstvo-racunovodski-sledljiv-inventar.json",
    ):
        rows = load(path)
        assert all(row["domain"] != "davčne evidence" for row in rows)
        assert all(not row["id"].startswith("TAX-") for row in rows)
    tax = load("docs/glavna-knjiga-prirocnik/Davcne-evidence-sledljiv-inventar.json")
    ids = {row["id"] for row in tax}
    assert ids == {
        "TAX-KIR-001", "TAX-KPR-001", "TAX-GL-001",
        "TAX-XML-001", "TAX-EDAVKI-001",
    }
    for row in tax:
        for field in ("ui_evidence", "api_evidence", "manual_evidence"):
            assert row[field]
            for reference in row[field]:
                path = reference.split(" — ", 1)[0]
                assert (ROOT / path).exists(), reference
        assert all("glavna-knjiga-prirocnik/" in ref for ref in row["manual_evidence"])
        assert all("artifacts/erp-web/" in ref for ref in row["ui_evidence"])


def test_reclassification_preserves_unsupported_tax_features():
    tax = {row["id"]: row for row in load(
        "docs/glavna-knjiga-prirocnik/Davcne-evidence-sledljiv-inventar.json"
    )}
    assert tax["TAX-GL-001"]["implementation_status"] == "NEPOTRJENO"
    assert tax["TAX-EDAVKI-001"]["implementation_status"] == "NI IMPLEMENTIRANO"


def test_pos_keeps_source_handover_not_tax_processing_instructions():
    source = (ROOT / "docs/pos-manual-src/06-izmene-porocila-nastavitve.md").read_text()
    assert "## 54. Predaja izvornih dokumentov računovodstvu" in source
    assert "Davčne evidence so del modula Glavna knjiga, ne POS Gostinstvo." in source
    assert "### 54.1 KIR" not in source
    assert "### 54.2 KPR" not in source
    chapter = (ROOT / "docs/glavna-knjiga-prirocnik/02-davcne-evidence.md").read_text()
    for phrase in ("KIR", "KPR", "Uskladitev", "XML izvoz", "eDavke"):
        assert phrase in chapter


def test_shared_renderer_does_not_assign_pos_packages_to_gl_chapter():
    spec = importlib.util.spec_from_file_location(
        "tax_pdf_renderer", ROOT / "scripts/generate_pos_manual_pdf.py"
    )
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    renderer.register_fonts()
    source = (ROOT / "docs/glavna-knjiga-prirocnik/02-davcne-evidence.md").read_text()
    flowables = renderer.markdown_to_flowables(
        source, renderer.make_styles(), 480, 2, "tax.md",
        include_pos_packages=False,
    )
    labels = [flow._manual_heading_text for flow in flowables
              if hasattr(flow, "_manual_heading_text")]
    assert labels
    assert all("[POS " not in label for label in labels)
