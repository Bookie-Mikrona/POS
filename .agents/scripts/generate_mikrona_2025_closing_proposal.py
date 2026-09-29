"""Read-only 2025 P&L closing proposal for Mikrona; never writes to the ledger."""

import csv
import json
import os
import subprocess
import uuid
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[2]
REPORTS = ROOT / "reports"
COMPANY_ID = str(uuid.UUID("80acfaf9-fd18-4e0a-8f03-bffbb2558893"))
BASELINE = REPORTS / "mikrona-2025-pdf-gk-reconciliation.csv"
PDF = REPORTS / "mikrona-2025-predlog-zakljucne-temeljnice.pdf"
CSV = REPORTS / "mikrona-2025-predlog-zakljucne-temeljnice.csv"
D = Decimal


def query(sql):
    env = {**os.environ, "PGOPTIONS": "-c default_transaction_read_only=on"}
    result = subprocess.run(
        ["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True, text=True, env=env, check=True,
    )
    return json.loads(result.stdout.strip())


def amount(value):
    return f"{value:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def main():
    period = query(
        "SELECT json_agg(row_to_json(p)) FROM ("
        "SELECT status FROM accounting_periods "
        f"WHERE company_id='{COMPANY_ID}' AND start_date <= '2025-01-01' "
        "AND end_date >= '2025-12-31') p"
    )
    if period != [{"status": "locked"}]:
        raise ValueError(f"2025 must still be locked: {period}")

    rows = query(
        "SELECT json_agg(row_to_json(q)) FROM ("
        "SELECT a.code, a.name, a.type, a.requires_cost_center, a.cost_center_policy, "
        "SUM(CASE WHEN l.side='debit' THEN l.amount::numeric ELSE -l.amount::numeric END)::text AS net "
        "FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id "
        "JOIN accounts a ON a.id=l.account_id "
        f"WHERE e.company_id='{COMPANY_ID}' AND e.status IN ('posted','reversed') "
        "AND e.entry_date >= '2025-01-01' AND e.entry_date < '2026-01-01' "
        "AND (a.type IN ('expense','revenue') OR a.code IN ('8100001','8150000','9320000')) "
        "GROUP BY a.code, a.name, a.type, a.requires_cost_center, a.cost_center_policy "
        "ORDER BY a.code) q"
    )
    if not rows:
        raise ValueError("No posted 2025 ledger balances found")

    with BASELINE.open(newline="", encoding="utf-8") as stream:
        comparison = list(csv.DictReader(stream))
    if len(comparison) != 65 or any(item["ujemanje"] != "DA" for item in comparison):
        raise ValueError("The 65-account approved comparison is missing or not fully matched")
    baseline_by_code = {item["novi_konto"]: item for item in comparison}
    proposed = []
    required_dimensions = []
    by_code = {row["code"]: row for row in rows}
    if len(by_code) != len(rows):
        raise ValueError("Duplicate account code in ledger result")
    if D(by_code["9320000"]["net"]) != D("-2474.76"):
        raise ValueError("The already-posted retained profit no longer matches the baseline")

    selected = [row for row in rows if row["code"] != "9320000" and D(row["net"]) != 0]
    expected_codes = {
        code for code, item in baseline_by_code.items()
        if (code.startswith(("4", "7")) or code in ("8100001", "8150000"))
        and D(item["gk_all_net"]) != 0
    }
    if {row["code"] for row in selected} != expected_codes:
        raise ValueError("Candidate account set differs from the approved trial balance")

    for row in selected + [by_code["9320000"]]:
        baseline = baseline_by_code.get(row["code"])
        if baseline is None or D(row["net"]) != D(baseline["gk_all_net"]):
            raise ValueError(f"Ledger drift since reconciliation: {row['code']}")

    for row in selected:
        code, net = row["code"], D(row["net"])
        if row["type"] == "revenue" and net < 0:
            debit, credit = -net, D("0")
        elif (row["type"] == "expense" or code in ("8100001", "8150000")) and net > 0:
            debit, credit = D("0"), net
        else:
            raise ValueError(f"Unexpected sign/type for account {code}: {row['type']} {net}")
        if row["requires_cost_center"] and row["cost_center_policy"] == "required":
            required_dimensions.append(code)
        proposed.append((code, row["name"], debit, credit))

    sum_debit = sum((x[2] for x in proposed), D("0"))
    sum_credit = sum((x[3] for x in proposed), D("0"))
    if (sum_debit, sum_credit) != (D("17703.75"), D("17703.75")):
        raise ValueError(f"Unbalanced or changed journal: {sum_debit} / {sum_credit}")
    if len(proposed) != 20 or len(required_dimensions) != 8:
        raise ValueError("The year-end account or required-dimension set changed; review again")

    with CSV.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.writer(stream)
        writer.writerow(["Status", "Predlog – NI KNJIŽENO"])
        writer.writerow(["Datum predloga", "2025-12-31"])
        writer.writerow(["Konto", "Naziv", "Breme EUR", "Dobro EUR"])
        for code, name, debit, credit in proposed:
            writer.writerow([code, name, f"{debit:.2f}", f"{credit:.2f}"])
        writer.writerow(["SKUPAJ", "", f"{sum_debit:.2f}", f"{sum_credit:.2f}"])

    pdfmetrics.registerFont(TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
    pdfmetrics.registerFont(TTFont("DejaVu-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
    styles = {
        "title": ParagraphStyle("title", fontName="DejaVu-Bold", fontSize=14, leading=19, textColor=colors.HexColor("#14263c")),
        "body": ParagraphStyle("body", fontName="DejaVu", fontSize=8.5, leading=13, textColor=colors.HexColor("#243447"), spaceAfter=6),
        "small": ParagraphStyle("small", fontName="DejaVu", fontSize=7.2, leading=10.5, textColor=colors.HexColor("#243447")),
        "label": ParagraphStyle("label", fontName="DejaVu-Bold", fontSize=8, leading=12, textColor=colors.HexColor("#95332c")),
        "cell": ParagraphStyle("cell", fontName="DejaVu", fontSize=7.4, leading=10),
        "money": ParagraphStyle("money", fontName="DejaVu", fontSize=7.4, leading=10, alignment=TA_RIGHT),
    }
    doc = SimpleDocTemplate(
        str(PDF), pagesize=A4, leftMargin=42, rightMargin=42,
        topMargin=43, bottomMargin=43, title="Pregledni predlog zaključne temeljnice 2025 – Mikrona",
    )
    story = [
        Paragraph("MIKRONA, PODJETJE ZA RAČUNALNIŠKI INŽENIRING, D.O.O.", styles["body"]),
        Paragraph("Pregledni predlog zaključne temeljnice 2025", styles["title"]),
        Spacer(1, 6),
        Paragraph("PREDLOG – NI KNJIŽENO. Obdobje 2025 je zaklenjeno; ta dokument ne spreminja glavne knjige.", styles["label"]),
        Spacer(1, 4),
        Paragraph(
            "Predlagani datum: 31. 12. 2025. Osnova: knjižene vrstice glavne knjige za leto 2025, "
            "usklajene z obema oddanima izpisoma (65 kontov). Gre samo za tehnično zaprtje "
            "prihodkovnih in odhodkovnih kontov ter že knjiženih kontov 810 in 815; "
            "ne za dodatno obračunavanje davka, popravek poslovnega izida ali otvoritev 2026.",
            styles["body"],
        ),
    ]
    table_rows = [[
        Paragraph("Konto", styles["label"]), Paragraph("Naziv konta", styles["label"]),
        Paragraph("Breme €", styles["label"]), Paragraph("Dobro €", styles["label"]),
    ]]
    for code, name, debit, credit in proposed:
        table_rows.append([
            Paragraph(code, styles["cell"]), Paragraph(name, styles["cell"]),
            Paragraph(amount(debit) if debit else "–", styles["money"]),
            Paragraph(amount(credit) if credit else "–", styles["money"]),
        ])
    table_rows.append([
        Paragraph("SKUPAJ", styles["label"]), "",
        Paragraph(amount(sum_debit), styles["money"]),
        Paragraph(amount(sum_credit), styles["money"]),
    ])
    t = Table(table_rows, colWidths=[60, 278, 76, 76], repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8eff6")),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#e8eff6")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#f8fafc")]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#bcc9d7")),
        ("LINEABOVE", (0, -1), (-1, -1), 0.6, colors.HexColor("#bcc9d7")),
    ]))
    story.extend([
        t, Spacer(1, 12),
        Paragraph(
            "<b>Kontrola:</b> prihodki 17.703,75 €; odhodki 14.896,10 €; "
            "že knjižen davek (810) 332,89 €; že knjižen čisti dobiček (815) 2.474,76 €. "
            "Konto 932 ima že knjižen dobro saldo 2.474,76 € in ga ta predlog ne povečuje.",
            styles["small"],
        ),
        Spacer(1, 7),
        Paragraph(
            "<b>Pred dejanskim knjiženjem:</b> računovodja mora potrditi razvrstitev, druge "
            "morebitne zaključne popravke in povezavo z oddanima izpisoma. Knjiženje po tem "
            "predlogu bi spremenilo usklajeno bruto bilanco za 2025. "
            f"ERP trenutno zahteva stroškovno mesto pri {len(required_dimensions)} stroškovnih "
            "kontih, Mikrona pa jih ne uporablja; ne vpisujte izmišljenih stroškovnih mest. "
            "Za knjiženje je potrebna najprej odločitev o nastavitvah kontov in odklenitev obdobja.",
            styles["small"],
        ),
        Spacer(1, 6),
        Paragraph(
            "Predlog ne določa otvoritvenih saldov na 1. 1. 2026 in ni potrditev, "
            "da so amortizacija, časovne razmejitve ali druge zaključne odločitve dokončne.",
            styles["small"],
        ),
    ])

    def footer(canvas, pdf_doc):
        canvas.saveState()
        canvas.setFont("DejaVu", 7)
        canvas.setFillColor(colors.HexColor("#6b7888"))
        stamp = datetime.now(ZoneInfo("Europe/Ljubljana")).strftime("%d. %m. %Y")
        canvas.drawString(42, 24, f"Pripravljeno {stamp} · NI KNJIŽENO")
        canvas.drawRightString(A4[0] - 42, 24, f"Stran {pdf_doc.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"Pregledni predlog: {len(proposed)} vrstic, {amount(sum_debit)} € / {amount(sum_credit)} €")
    print(f"Obvezne dimenzije: {', '.join(required_dimensions)}")
    print(PDF.relative_to(ROOT), CSV.relative_to(ROOT))


if __name__ == "__main__":
    main()