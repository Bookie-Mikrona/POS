"""Generate the unposted 2025 closing proposals from reconciled source files."""

import csv
import zipfile
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Table,
    TableStyle,
    PageBreak,
    Spacer,
)


ROOT = Path(__file__).resolve().parent.parent
REPORTS = ROOT / "reports"
SOURCE = ROOT / "attached_assets/0_JOLP_5711053000__20260930002529_1790720567717.xlsx"
PREVIOUS = REPORTS / "mikrona-2025-predlog-zakljucne-temeljnice.csv"
RECONCILIATION = REPORTS / "mikrona-2025-pdf-gk-reconciliation.csv"
OUTPUT = REPORTS / "mikrona-2025-predlog-zakljucnih-temeljnic"
CENT = Decimal("0.01")
STATUS = "PREDLOG - NI KNJIŽENO"


def money(value):
    return Decimal(str(value)).quantize(CENT)


def formatted(value):
    if value == 0:
        return "–"
    return f"{value:,.2f}".replace(",", " ").replace(".", ",")


def source_values():
    """Read only the numeric cells used as controls in the supplied JOLP export."""
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    required = {
        "sheet1.xml": ("B39", "B42", "C42", "B45", "C45", "B46"),
        "sheet2.xml": ("B41", "B43", "B50", "B51", "B56"),
    }
    with zipfile.ZipFile(SOURCE) as workbook:
        result = {}
        for sheet, addresses in required.items():
            root = ET.fromstring(workbook.read("xl/worksheets/" + sheet))
            cells = {
                cell.get("r"): cell.find("s:v", ns)
                for cell in root.findall(".//s:sheetData/s:row/s:c", ns)
            }
            result[sheet] = {a: money(cells[a].text) for a in addresses}
    return result


def first_proposal():
    with PREVIOUS.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.reader(handle))
    assert rows[:3] == [
        ["Status", "Predlog – NI KNJIŽENO"],
        ["Datum predloga", "2025-12-31"],
        ["Konto", "Naziv", "Breme EUR", "Dobro EUR"],
    ]
    lines = [(r[0], r[1], money(r[2]), money(r[3])) for r in rows[3:-1]]
    assert len(lines) == 20
    assert (sum(r[2] for r in lines), sum(r[3] for r in lines)) == (
        Decimal("17703.75"),
        Decimal("17703.75"),
    )
    assert rows[-1] == ["SKUPAJ", "", "17703.75", "17703.75"]
    return lines


def ledger_equity():
    with RECONCILIATION.open(newline="", encoding="utf-8") as handle:
        by_account = {row["novi_konto"]: row for row in csv.DictReader(handle)}
    return {
        account: (
            money(by_account[account]["gk_all_d"]),
            money(by_account[account]["gk_all_c"]),
        )
        for account in ("9200000", "9310000", "9320000")
    }


def controls(lines1, lines2):
    bs, pl = source_values()["sheet1.xml"], source_values()["sheet2.xml"]
    assert bs == {
        "B39": Decimal("8763.14"),
        "B42": Decimal("876.31"),
        "C42": Decimal("757.31"),
        "B45": Decimal("0.00"),
        "C45": Decimal("-2295.11"),
        "B46": Decimal("60.65"),
    }
    assert pl == {
        "B41": Decimal("2474.76"),
        "B43": Decimal("-2295.11"),
        "B50": Decimal("119.00"),
        "B51": Decimal("119.00"),
        "B56": Decimal("60.65"),
    }
    assert (sum(r[2] for r in lines2), sum(r[3] for r in lines2)) == (
        Decimal("2414.11"),
        Decimal("2414.11"),
    )
    assert money(pl["B41"] + pl["B43"] - pl["B51"]) == pl["B56"]
    balances = ledger_equity()
    for account, _, debit, credit in lines2:
        old_debit, old_credit = balances[account]
        balances[account] = old_debit + debit, old_credit + credit
    assert balances["9200000"][1] - balances["9200000"][0] == bs["B42"]
    assert balances["9310000"][0] - balances["9310000"][1] == bs["B45"]
    assert balances["9320000"][1] - balances["9320000"][0] == bs["B46"]
    assert len(lines1) == 20 and len(lines2) == 3


def write_csv(lines1, lines2):
    with OUTPUT.with_suffix(".csv").open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle, delimiter=";")
        writer.writerow(
            ["Temeljnica", "Datum", "Vrstica", "Konto", "Naziv",
             "Breme EUR", "Dobro EUR", "Status", "Vir"]
        )
        for number, lines, source in (
            ("ZT-2025-01", lines1, "Usklajena GK 2025 / oddana Bilanca in Zaključni račun"),
            ("ZT-2025-02", lines2, "AJPES JOLP 2025 / izkaz poslovnega izida in bilanca stanja"),
        ):
            for index, (account, name, debit, credit) in enumerate(lines, 1):
                writer.writerow(
                    [number, "2025-12-31", index, account, name,
                     f"{debit:.2f}", f"{credit:.2f}", STATUS, source]
                )


FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
pdfmetrics.registerFont(TTFont("DV", FONT))
pdfmetrics.registerFont(TTFont("DV-Bold", BOLD))
pdfmetrics.registerFontFamily("DV", normal="DV", bold="DV-Bold")
body = ParagraphStyle("body", fontName="DV", fontSize=8, leading=12, spaceAfter=8)
small = ParagraphStyle("small", parent=body, fontSize=7.2, leading=10)
title = ParagraphStyle("title", parent=body, fontName="DV-Bold", fontSize=15, leading=19, spaceAfter=13)
heading = ParagraphStyle("heading", parent=body, fontName="DV-Bold", fontSize=10, leading=14, spaceBefore=12)
right = ParagraphStyle("right", parent=small, alignment=TA_RIGHT)


def paragraph(text, style=body):
    return Paragraph(text, style)


def table(lines):
    grid = [[paragraph("Konto", small), paragraph("Naziv", small),
             paragraph("Breme €", right), paragraph("Dobro €", right)]]
    for account, name, debit, credit in lines:
        grid.append(
            [paragraph(account, small), paragraph(escape(name), small),
             paragraph(formatted(debit), right), paragraph(formatted(credit), right)]
        )
    grid.append(
        [paragraph("<b>SKUPAJ</b>", small), "",
         paragraph(f"<b>{formatted(sum(r[2] for r in lines))}</b>", right),
         paragraph(f"<b>{formatted(sum(r[3] for r in lines))}</b>", right)]
    )
    result = Table(grid, colWidths=[58, 267, 76, 76], repeatRows=1, hAlign="LEFT")
    result.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8eef2")),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#e8eef2")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, 0), .4, colors.HexColor("#8395a4")),
        ("LINEABOVE", (0, -1), (-1, -1), .4, colors.HexColor("#8395a4")),
    ]))
    return result


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("DV", 7)
    canvas.drawString(17 * mm, 12 * mm, "MIKRONA · 2025 · PREDLOG – NI KNJIŽENO")
    canvas.drawRightString(193 * mm, 12 * mm, f"Stran {doc.page}")
    canvas.restoreState()


def write_pdf(lines1, lines2):
    doc = SimpleDocTemplate(
        str(OUTPUT.with_suffix(".pdf")), pagesize=A4,
        leftMargin=17 * mm, rightMargin=17 * mm,
        topMargin=17 * mm, bottomMargin=21 * mm,
    )
    content = [
        paragraph("MIKRONA, PODJETJE ZA RAČUNALNIŠKI INŽENIRING, D.O.O.", small),
        paragraph("Pregledni predlog zaključnih temeljnic 2025", title),
        paragraph(
            "<b>PREDLOG – NI KNJIŽENO.</b> Predlagani datum obeh temeljnic: "
            "31. 12. 2025. Leto 2025 ostaja zaklenjeno. Dokument je namenjen "
            "pregledu, ne uvozu ali samodejnemu knjiženju."
        ),
        paragraph("ZT-2025-01 · Zapiranje prihodkov in odhodkov", heading),
        paragraph(
            "Vir: že usklajena GK 2025 in izvirna oddana izpisa Bilanca ter "
            "Zaključni račun. Predlog zapira tudi že knjižena konta 810 in 815; "
            "ne obračunava davka znova in ne povečuje že knjiženega dobička na 932.", small
        ),
        table(lines1),
        Spacer(1, 8),
        paragraph(
            "<b>Kontrola:</b> prihodki 17.703,75 €; odhodki 14.896,10 €; "
            "že knjižen davek 332,89 €; že knjižen čisti dobiček 2.474,76 €.", small
        ),
        PageBreak(),
        paragraph("ZT-2025-02 · Razporeditev čistega dobička", heading),
        paragraph(
            "Vir: uporabnikov izvoz AJPES JOLP za Mikrono 2025, izkaz poslovnega "
            "izida (postavke 19, 21, 24, 24.a in 25) in bilanca stanja. "
            "Temeljnica pokrije preneseno izgubo in poveča zakonske rezerve.", small
        ),
        table(lines2),
        Spacer(1, 12),
        paragraph(
            "<b>Kontrola AJPES:</b> 2.474,76 € čistega dobička − 2.295,11 € "
            "prenesene izgube − 119,00 € povečanja zakonskih rezerv = "
            "<b>60,65 € bilančnega dobička</b>.", body
        ),
        paragraph(
            "<b>Stanje kapitalskih kontov po predlagani ZT-2025-02</b> "
            "(ob predpostavki nespremenjene preverjene GK): 920 zakonske rezerve "
            "876,31 € v dobro; 931 prenesena izguba 0,00 €; 932 ostanek čistega "
            "dobička 60,65 € v dobro. Tako se ujemajo postavke kapitala v "
            "priloženem izkazu AJPES. Skupni kapital se s prerazporeditvijo ne spremeni.", body
        ),
        paragraph(
            "<b>Pred knjiženjem:</b> računovodja naj potrdi, da ni drugih "
            "zaključnih popravkov ali že opravljenih poznejših prerazporeditev. "
            "Izvoz AJPES izkazuje 119,00 € povečanja zakonskih rezerv, ne pa "
            "datuma ali številke sklepa. Knjiženje bi spremenilo bruto bilanco "
            "glede na izvirni izpis. ERP pri delu stroškovnih kontov zahteva "
            "stroškovno mesto, Mikrona pa ga ne uporablja: ne dodajaj izmišljenih "
            "dimenzij; pred knjiženjem razreši nastavitve kontov in zaklenjeno obdobje.", body
        ),
        paragraph(
            "Predlog ne določa otvoritve 2026 in ne potrjuje, da so amortizacija, "
            "časovne razmejitve ali druge zaključne odločitve dokončne.", small
        ),
    ]
    doc.build(content, onFirstPage=footer, onLaterPages=footer)


def main():
    lines1 = first_proposal()
    lines2 = [
        ("9320000", "Ostanek čistega dobička poslovnega leta", Decimal("2414.11"), Decimal("0.00")),
        ("9310000", "Prenesena čista izguba iz prejšnjih let", Decimal("0.00"), Decimal("2295.11")),
        ("9200000", "Zakonske rezerve", Decimal("0.00"), Decimal("119.00")),
    ]
    controls(lines1, lines2)
    write_csv(lines1, lines2)
    write_pdf(lines1, lines2)
    print("Verified 20 + 3 lines against JOLP and GK; wrote CSV and PDF.")


if __name__ == "__main__":
    main()