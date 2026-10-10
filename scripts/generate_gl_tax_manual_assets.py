#!/usr/bin/env python3
"""Export the Glavna knjiga tax chapter and its own traceability inventory."""

from datetime import date
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, Spacer

import generate_pos_manual_inventory as inventory
import generate_pos_manual_pdf as pdf

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs/glavna-knjiga-prirocnik"
OUTPUT = ROOT / "generated-artifacts/Glavna-knjiga-davcne-evidence.pdf"


class TaxChapterDoc(pdf.ManualDocTemplate):
    def draw_page(self, canvas, doc):
        canvas.saveState()
        canvas.setFont("Manual", 8)
        canvas.setFillColor(pdf.MUTED)
        canvas.drawString(19 * mm, 12 * mm, "Glavna knjiga — davčne evidence")
        canvas.drawRightString(A4[0] - 19 * mm, 12 * mm, f"Stran {doc.page}")
        canvas.restoreState()


def main() -> None:
    inventory.CANONICAL_JSON = DOCS / "Davcne-evidence-sledljiv-inventar.json"
    inventory.CSV_OUTPUT = DOCS / "Davcne-evidence-sledljiv-inventar.csv"
    inventory.XLSX_OUTPUT = DOCS / "Davcne-evidence-sledljiv-inventar.xlsx"
    inventory.MD_OUTPUT = DOCS / "Davcne-evidence-sledljiv-inventar.md"
    inventory.INVENTORY_TITLE = "Glavna knjiga — sledljiv inventar davčnih evidenc"
    inventory.REVIEW_REPORT = "02-davcne-evidence.md"
    inventory.REVIEW_DATE = date(2026, 10, 10)
    rows = inventory.load_rows()
    inventory.write_csv(rows)
    inventory.write_markdown(rows)
    inventory.write_workbook(rows)

    pdf.register_fonts()
    styles = pdf.make_styles()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = TaxChapterDoc(
        str(OUTPUT), styles, pagesize=A4,
        leftMargin=19 * mm, rightMargin=19 * mm,
        topMargin=18 * mm, bottomMargin=21 * mm,
        title="Glavna knjiga — davčne evidence", author="Bookie",
    )
    story = [
        Paragraph("Bookie ERP — Glavna knjiga", styles["cover_meta"]),
        Paragraph("Poglavje delovnega priročnika · 10.10.2026", styles["cover_meta"]),
        Spacer(1, 5 * mm),
    ]
    story.extend(pdf.markdown_to_flowables(
        (DOCS / "02-davcne-evidence.md").read_text(encoding="utf-8"),
        styles, doc.width, chapter_number=2,
        source_name="glavna-knjiga/02-davcne-evidence.md",
        include_pos_packages=False,
    ))
    doc.multiBuild(story)
    print(f"{len(rows)} davčnih postopkov; {OUTPUT}")


if __name__ == "__main__":
    main()
