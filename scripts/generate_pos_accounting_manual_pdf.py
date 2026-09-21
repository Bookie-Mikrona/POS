#!/usr/bin/env python3
"""Generate the standalone POS Gostinstvo accounting manual."""

from datetime import date
from pathlib import Path
import html

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, Spacer, Table, TableStyle, Image as RLImage
from reportlab.platypus.tableofcontents import TableOfContents

import generate_pos_manual_pdf as base

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "docs" / "pos-accounting-manual-src"
OUTPUT = ROOT / "docs" / "POS-Gostinstvo-racunovodski-prirocnik-v1.1.pdf"
SOURCE_FILES = [
    ("I", "Računovodska sled in delo s temeljnicami", "00-uvod-in-delo-s-temeljnicami.md"),
    ("II", "Privzeti konti in preslikave", "01-privzeti-konti.md"),
    ("III", "Prodaja, plačila, DDV, boni, napitnine in storni", "02-prodaja-placila-temeljnice.md"),
    ("IV", "Nabava, zaloga in drugi računovodski dogodki", "03-nabava-zaloga-drugi-dogodki.md"),
]


class AccountingManualDocTemplate(base.ManualDocTemplate):
    def draw_page(self, canvas, doc) -> None:
        canvas.saveState()
        page = canvas.getPageNumber()
        if page > 1:
            canvas.setStrokeColor(base.LINE)
            canvas.setLineWidth(0.4)
            canvas.line(18 * mm, 16.5 * mm, A4[0] - 18 * mm, 16.5 * mm)
            canvas.setFont("Manual", 8.2)
            canvas.setFillColor(base.MUTED)
            canvas.drawString(18 * mm, 11.5 * mm, "POS Gostinstvo — računovodski priročnik v1.1")
            canvas.drawRightString(A4[0] - 18 * mm, 11.5 * mm, f"Stran {page}")
        canvas.restoreState()


def build_story(styles, doc):
    story = [
        RLImage(str(base.LOGO), width=43 * mm, height=44 * mm),
        Spacer(1, 7 * mm),
        Paragraph("Mikrona d.o.o.", styles["cover_meta"]),
        Spacer(1, 38 * mm),
        Paragraph("POS Gostinstvo", styles["cover_title"]),
        Paragraph("Računovodski priročnik · izdaja 1.1", styles["cover_subtitle"]),
        Spacer(1, 13 * mm),
        Table(
            [
                ["Različica", "1.1"],
                ["Obseg", "privzeti konti, tvorba temeljnic, prodaja, plačila, DDV, nabava, zaloga, kontrole in robni primeri"],
                ["Datum izdaje", date.today().strftime("%d.%m.%Y")],
            ],
            colWidths=[40 * mm, 110 * mm],
            style=TableStyle([
                ("FONTNAME", (0, 0), (0, -1), "Manual-Bold"),
                ("FONTNAME", (1, 0), (1, -1), "Manual"),
                ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                ("GRID", (0, 0), (-1, -1), 0.5, base.LINE),
                ("BACKGROUND", (0, 0), (0, -1), base.PALE_BLUE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
            ]),
        ),
        Spacer(1, 18 * mm),
        Paragraph(
            "Samostojen priročnik za računovodski pregled dogodkov, ki nastanejo v modulu POS Gostinstvo, in za uporabo ustvarjenih temeljnic v glavni knjigi.",
            styles["cover_meta"],
        ),
        PageBreak(),
        Paragraph("Kako uporabljate priročnik", styles["h1"]),
        Paragraph(
            "Vsak primer začne z vnosom v programu, nadaljuje z uporabljenimi privzetimi konti in konča z natančno D/K temeljnico ter kontrolo robnih primerov. Številke kontov v primerih so ponazoritvene; vedno preverite dejansko kodo in naziv konta podjetja.",
            styles["body"],
        ),
        Paragraph(
            "<b>Kontrolno pravilo:</b> temeljnice ne popravljajte tako, da zakrijete napako izvornega POS-dokumenta. Najprej popravite oziroma razveljavite izvor, nato ponovno ustvarite računovodsko sled.",
            styles["quote"],
        ),
        Paragraph("Kazalo", styles["toc_title"]),
    ]
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("ATOC0", fontName="Manual-Bold", fontSize=10.2, leading=15, textColor=base.BLUE),
        ParagraphStyle("ATOC1", fontName="Manual", fontSize=9.2, leading=13, leftIndent=7 * mm, textColor=base.INK),
        ParagraphStyle("ATOC2", fontName="Manual", fontSize=8.6, leading=12, leftIndent=14 * mm, textColor=base.MUTED),
        ParagraphStyle("ATOC3", fontName="Manual", fontSize=8.2, leading=11, leftIndent=21 * mm, textColor=base.MUTED),
    ]
    story.extend([toc, PageBreak()])
    for numeral, title, filename in SOURCE_FILES:
        part = Paragraph(f"DEL {numeral}<br/><br/>{html.escape(title)}", styles["part"])
        part._manual_heading_level = 1
        part._manual_heading_text = f"DEL {numeral}: {title}"
        story.extend([Spacer(1, 45 * mm), part, PageBreak()])
        markdown = (SOURCE_DIR / filename).read_text(encoding="utf-8").replace(
            "](../pos-accounting-manual-images/",
            "](docs/pos-accounting-manual-images/",
        )
        story.extend(base.markdown_to_flowables(markdown, styles, doc.width))
        story.append(PageBreak())
    story.extend([Spacer(1, 45 * mm), Paragraph("Konec računovodskega priročnika", styles["part"])])
    return story


def main() -> None:
    base.register_fonts()
    styles = base.make_styles()
    doc = AccountingManualDocTemplate(
        str(OUTPUT),
        styles,
        pagesize=A4,
        leftMargin=19 * mm,
        rightMargin=19 * mm,
        topMargin=18 * mm,
        bottomMargin=21 * mm,
        title="POS Gostinstvo — računovodski priročnik v1.1",
        author="Bookie",
        subject="Računovodski priročnik za modul POS Gostinstvo",
        creator="Bookie POS Gostinstvo",
    )
    doc.multiBuild(build_story(styles, doc))
    print(OUTPUT)


if __name__ == "__main__":
    main()