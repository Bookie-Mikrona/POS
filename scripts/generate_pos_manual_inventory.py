#!/usr/bin/env python3
"""Build the POS Gostinstvo manual traceability inventory.

The first run imports the reviewed audit fragments from /tmp and writes a
canonical JSON file. Later runs use that canonical file, so the workbook is
reproducible without the temporary audit fragments.
"""

from __future__ import annotations

import csv
import json
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

import xlsxwriter


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
CANONICAL_JSON = DOCS / "POS-Gostinstvo-sledljiv-inventar.json"
CSV_OUTPUT = DOCS / "POS-Gostinstvo-sledljiv-inventar.csv"
XLSX_OUTPUT = DOCS / "POS-Gostinstvo-sledljiv-inventar.xlsx"
MD_OUTPUT = DOCS / "POS-Gostinstvo-sledljiv-inventar.md"

AUDIT_FILES = [Path(f"/tmp/inventory-sl2-{index}.json") for index in range(1, 6)]
REVIEW_DATE = date(2026, 9, 21)

STATUS_MAP = {
    "CORRECT": "PRAVILNO",
    "PARTIAL": "DELNO",
    "MISSING": "MANJKA",
    "WRONG": "NAPAČNO",
    "NOT_IMPLEMENTED": "NI IMPLEMENTIRANO",
}
SEVERITY_MAP = {
    "CRITICAL": "KRITIČNO",
    "HIGH": "VISOKO",
    "MEDIUM": "SREDNJE",
    "LOW": "NIZKO",
}

DOMAIN_PREFIXES = {
    "dostop": "DOST",
    "izmene": "IZM",
    "identiteta": "ID",
    "naprave": "NAP",
    "mize": "MIZ",
    "rezervacije": "REZ",
    "naročila": "NAR",
    "hodi": "HOD",
    "telefon in dostava": "TEL",
    "osebje": "OSE",
    "nastavitve": "NAS",
    "blagajna": "PLA",
    "računi": "RAC",
    "fiskalizacija": "FUR",
    "nadzor gotovine": "GOT",
    "meni": "MEN",
    "normativi": "NOR",
    "nabava": "NAB",
    "zaloga": "ZAL",
    "povratna embalaža": "EMB",
    "dogodki in prenosi": "DOG",
    "kds/točilnica/pica/izdaja": "KDS",
    "večhodni meni": "VHM",
    "ai": "AI",
    "qr meni": "QR",
    "brskanje": "QR",
    "za s seboj": "QR",
    "naročanje": "QR",
    "klic natakarja": "QR",
    "napitnine": "NAPT",
    "zgodovina naročil": "QR",
    "povratne informacije": "QR",
    "gostujoči ai": "QR",
    "identiteta telefona/stranke": "TEL",
    "nastavitve pos knjiženja": "ERP",
    "povezave kontov/ddv": "ERP",
    "dnevniki": "ERP",
    "poročanje": "POR",
    "dnevni zaključek": "ZAK",
    "plačila": "PLA",
    "uporabniki/vloge": "UPR",
    "naprave/tiskalniki/integracije": "NAP",
    "revizija/varnost": "REV",
}

HEADERS = [
    "ID",
    "Področje",
    "Funkcija oziroma postopek",
    "Uporabniške vloge",
    "Predpogoji",
    "Običajni potek",
    "Napake in varno nadaljevanje",
    "Poslovni oziroma evidenčni učinek",
    "Dokaz v uporabniškem vmesniku",
    "Dokaz v API-ju ali strežniku",
    "Dokaz v priročniku",
    "Pokritost priročnika",
    "Pomembnost",
    "Ugotovljena vrzel ali potreben popravek",
    "Datum pregleda",
]


def as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    return [text] if text else []


def list_text(value: Any, separator: str = "\n") -> str:
    return separator.join(as_list(value))


def normalize_domain(value: str) -> str:
    aliases = {
        "access": "Dostop",
        "shifts": "Izmene",
        "identity": "Identiteta",
        "tables": "Mize",
        "reservations": "Rezervacije",
        "orders": "Naročila",
        "courses": "Hodi",
        "phone_delivery": "Telefon in dostava",
        "staff": "Osebje",
        "settings": "Nastavitve",
        "checkout": "Blagajna",
        "receipts": "Računi",
        "fiscal": "Fiskalizacija",
        "cash-control": "Nadzor gotovine",
        "recipes": "Normativi",
        "purchasing": "Nabava",
        "stock": "Zaloga",
        "returnable packaging": "Povratna embalaža",
        "events and transfers": "Dogodki in prenosi",
        "KDS/bar/pizza/dispatch": "KDS/točilnica/pica/izdaja",
        "multicourse": "Večhodni meni",
        "AI": "AI",
    }
    return aliases.get(value, value).strip()


def merge_unique(left: Any, right: Any) -> list[str]:
    result: list[str] = []
    for item in as_list(left) + as_list(right):
        if item not in result:
            result.append(item)
    return result


def import_audit_rows() -> list[dict[str, Any]]:
    missing = [str(path) for path in AUDIT_FILES if not path.exists()]
    if missing:
        raise FileNotFoundError(
            "Manjkajo začasni rezultati pregleda in kanonični inventar še ne obstaja: "
            + ", ".join(missing)
        )

    rows: list[dict[str, Any]] = []
    for path in AUDIT_FILES:
        rows.extend(json.loads(path.read_text(encoding="utf-8")))

    # Both the payment and public audit contain the same tip workflow. Preserve
    # all evidence in one row and mark the documentation as partial because the
    # policy, allocation and public QR aspects are not fully described.
    tip_rows = [row for row in rows if str(row.get("id", "")).lower() == "tips"]
    rows = [row for row in rows if str(row.get("id", "")).lower() != "tips"]
    if tip_rows:
        merged = dict(tip_rows[0])
        for other in tip_rows[1:]:
            for field in (
                "user_roles",
                "prerequisites",
                "ui_evidence",
                "api_evidence",
                "manual_evidence",
            ):
                merged[field] = merge_unique(merged.get(field), other.get(field))
        merged["domain"] = "Napitnine"
        merged["coverage_status"] = "PARTIAL"
        merged["severity"] = "HIGH"
        merged["gap_or_correction"] = (
            "Osnovni zajem napitnine je opisan, manjkajo pa celotna politika, "
            "razdelitev, računovodsko zapiranje in javni QR vidik."
        )
        rows.append(merged)

    rows.sort(key=lambda row: (normalize_domain(str(row.get("domain", ""))), str(row.get("feature", ""))))

    counters: Counter[str] = Counter()
    normalized: list[dict[str, Any]] = []
    for row in rows:
        domain = normalize_domain(str(row.get("domain", "")).strip())
        prefix = DOMAIN_PREFIXES.get(domain.lower(), "POS")
        counters[prefix] += 1
        normalized_row = dict(row)
        normalized_row["id"] = f"{prefix}-{counters[prefix]:03d}"
        normalized_row["domain"] = domain
        normalized_row["coverage_status"] = STATUS_MAP.get(
            str(row.get("coverage_status", "")),
            str(row.get("coverage_status", "")),
        )
        normalized_row["severity"] = SEVERITY_MAP.get(
            str(row.get("severity", "")),
            str(row.get("severity", "")),
        )
        normalized.append(normalized_row)

    return normalized


def load_rows() -> list[dict[str, Any]]:
    if CANONICAL_JSON.exists():
        return json.loads(CANONICAL_JSON.read_text(encoding="utf-8"))

    rows = import_audit_rows()
    CANONICAL_JSON.write_text(
        json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return rows


def row_values(row: dict[str, Any], separator: str = "\n") -> list[str]:
    return [
        str(row["id"]),
        str(row["domain"]),
        str(row["feature"]),
        list_text(row.get("user_roles"), separator),
        list_text(row.get("prerequisites"), separator),
        str(row.get("normal_flow", "")),
        str(row.get("exceptions_recovery", "")),
        str(row.get("business_effect", "")),
        list_text(row.get("ui_evidence"), separator),
        list_text(row.get("api_evidence"), separator),
        list_text(row.get("manual_evidence"), separator),
        str(row.get("coverage_status", "")),
        str(row.get("severity", "")),
        str(row.get("gap_or_correction", "")),
        REVIEW_DATE.strftime("%d.%m.%Y"),
    ]


def write_csv(rows: list[dict[str, Any]]) -> None:
    with CSV_OUTPUT.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";")
        writer.writerow(HEADERS)
        for row in rows:
            writer.writerow(row_values(row, separator=" | "))


def write_markdown(rows: list[dict[str, Any]]) -> None:
    status_counts = Counter(str(row["coverage_status"]) for row in rows)
    severity_counts = Counter(str(row["severity"]) for row in rows)
    priority = [
        row
        for row in rows
        if row["coverage_status"] != "PRAVILNO"
        and row["severity"] in {"KRITIČNO", "VISOKO"}
    ]

    lines = [
        "# POS Gostinstvo — sledljiv inventar priročnika",
        "",
        f"**Datum pregleda:** {REVIEW_DATE.strftime('%d.%m.%Y')}  ",
        f"**Število preverjenih uporabniških postopkov:** {len(rows)}",
        "",
        "Inventar povezuje uporabniško funkcijo z dokazom v uporabniškem vmesniku, "
        "strežniški izvedbi in priročniku. Status ne ocenjuje kakovosti kode, ampak "
        "pokritost uporabniškega postopka v priročniku.",
        "",
        "## Povzetek pokritosti",
        "",
        "| Status | Število |",
        "|---|---:|",
    ]
    for status in ("PRAVILNO", "DELNO", "MANJKA", "NAPAČNO", "NI IMPLEMENTIRANO"):
        lines.append(f"| {status} | {status_counts.get(status, 0)} |")

    lines.extend(
        [
            "",
            "## Pomembnost",
            "",
            "| Pomembnost | Število |",
            "|---|---:|",
        ]
    )
    for severity in ("KRITIČNO", "VISOKO", "SREDNJE", "NIZKO"):
        lines.append(f"| {severity} | {severity_counts.get(severity, 0)} |")

    lines.extend(
        [
            "",
            "## Kritične in visoke dokumentacijske vrzeli",
            "",
            "| ID | Področje | Funkcija | Pokritost | Vrzel oziroma popravek |",
            "|---|---|---|---|---|",
        ]
    )
    for row in priority:
        gap = str(row["gap_or_correction"]).replace("|", "\\|").replace("\n", " ")
        feature = str(row["feature"]).replace("|", "\\|")
        lines.append(
            f"| {row['id']} | {row['domain']} | {feature} | "
            f"{row['coverage_status']} | {gap} |"
        )

    lines.extend(
        [
            "",
            "## Celoten inventar",
            "",
            "Celotna dokazila, predpogoji, postopki in reference so v preglednici "
            "`POS-Gostinstvo-sledljiv-inventar.xlsx` ter v strojno berljivih "
            "datotekah JSON in CSV.",
            "",
            "| ID | Področje | Funkcija | Pokritost | Pomembnost |",
            "|---|---|---|---|---|",
        ]
    )
    for row in rows:
        feature = str(row["feature"]).replace("|", "\\|")
        lines.append(
            f"| {row['id']} | {row['domain']} | {feature} | "
            f"{row['coverage_status']} | {row['severity']} |"
        )
    MD_OUTPUT.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_workbook(rows: list[dict[str, Any]]) -> None:
    workbook = xlsxwriter.Workbook(XLSX_OUTPUT)
    workbook.set_properties(
        {
            "title": "POS Gostinstvo — sledljiv inventar priročnika",
            "subject": "Sledljivost funkcij programa do uporabniškega priročnika",
            "author": "Bookie",
            "company": "Mikrona d.o.o.",
            "comments": f"Pregled izveden {REVIEW_DATE.strftime('%d.%m.%Y')}",
        }
    )

    blue = "#163A5F"
    teal = "#087F8C"
    pale_blue = "#EAF2F8"
    pale_yellow = "#FFF2CC"
    pale_red = "#FCE8E6"
    pale_green = "#E2F0D9"
    gray = "#E7E6E6"
    ink = "#1C2733"

    title_format = workbook.add_format(
        {"bold": True, "font_size": 20, "font_color": blue}
    )
    subtitle_format = workbook.add_format({"font_size": 10, "font_color": "#566573"})
    section_format = workbook.add_format(
        {
            "bold": True,
            "font_size": 12,
            "font_color": "white",
            "bg_color": teal,
            "border": 1,
        }
    )
    header_format = workbook.add_format(
        {
            "bold": True,
            "font_color": "white",
            "bg_color": blue,
            "border": 1,
            "align": "center",
            "valign": "vcenter",
            "text_wrap": True,
        }
    )
    text_format = workbook.add_format(
        {
            "font_color": ink,
            "border": 1,
            "valign": "top",
            "text_wrap": True,
        }
    )
    center_format = workbook.add_format(
        {
            "font_color": ink,
            "border": 1,
            "align": "center",
            "valign": "top",
            "text_wrap": True,
        }
    )
    metric_label = workbook.add_format(
        {"bold": True, "bg_color": pale_blue, "border": 1}
    )
    metric_value = workbook.add_format(
        {"bold": True, "font_size": 14, "align": "center", "border": 1}
    )
    note_format = workbook.add_format(
        {"font_color": ink, "bg_color": pale_yellow, "border": 1, "text_wrap": True}
    )

    summary = workbook.add_worksheet("Povzetek")
    summary.hide_gridlines(2)
    summary.set_column("A:A", 27)
    summary.set_column("B:B", 14)
    summary.set_column("D:D", 27)
    summary.set_column("E:E", 14)
    summary.write("A1", "POS Gostinstvo — sledljiv inventar", title_format)
    summary.write(
        "A2",
        f"Pregled uporabniških postopkov in pokritosti priročnika · "
        f"{REVIEW_DATE.strftime('%d.%m.%Y')}",
        subtitle_format,
    )
    summary.write("A4", "Osnovni podatki", section_format)
    summary.write("A5", "Preverjeni postopki", metric_label)
    summary.write_number("B5", len(rows), metric_value)
    summary.write("A6", "Kritične ali visoke vrzeli", metric_label)
    high_gaps = sum(
        1
        for row in rows
        if row["coverage_status"] != "PRAVILNO"
        and row["severity"] in {"KRITIČNO", "VISOKO"}
    )
    summary.write_number("B6", high_gaps, metric_value)
    summary.write("A7", "Ni implementirano", metric_label)
    not_implemented = sum(
        1 for row in rows if row["coverage_status"] == "NI IMPLEMENTIRANO"
    )
    summary.write_number("B7", not_implemented, metric_value)
    summary.write("A9", "Pokritost priročnika", section_format)
    summary.write("A10", "Status", header_format)
    summary.write("B10", "Število", header_format)

    status_order = ["PRAVILNO", "DELNO", "MANJKA", "NAPAČNO", "NI IMPLEMENTIRANO"]
    status_counts = Counter(str(row["coverage_status"]) for row in rows)
    for offset, status in enumerate(status_order, start=11):
        summary.write(offset - 1, 0, status, text_format)
        summary.write_number(offset - 1, 1, status_counts.get(status, 0), center_format)

    summary.write("D9", "Pomembnost", section_format)
    summary.write("D10", "Stopnja", header_format)
    summary.write("E10", "Število", header_format)
    severity_order = ["KRITIČNO", "VISOKO", "SREDNJE", "NIZKO"]
    severity_counts = Counter(str(row["severity"]) for row in rows)
    for offset, severity in enumerate(severity_order, start=11):
        summary.write(offset - 1, 3, severity, text_format)
        summary.write_number(
            offset - 1, 4, severity_counts.get(severity, 0), center_format
        )

    summary.write("A18", "Pravilo uporabe", section_format)
    summary.merge_range(
        "A19:E21",
        "Vsaka nova ali spremenjena uporabniška funkcija mora imeti svojo vrstico. "
        "Pred izdajo priročnika morajo biti vse vrstice s statusom DELNO, MANJKA "
        "ali NAPAČNO pregledane. NI IMPLEMENTIRANO pomeni omejitev izdelka, ne "
        "dokumentacijske napake; priročnik mora omejitev jasno povedati, kadar bi "
        "uporabnik funkcijo lahko pričakoval.",
        note_format,
    )

    chart = workbook.add_chart({"type": "column"})
    chart.add_series(
        {
            "name": "Pokritost",
            "categories": "=Povzetek!$A$11:$A$15",
            "values": "=Povzetek!$B$11:$B$15",
            "fill": {"color": teal},
            "border": {"none": True},
        }
    )
    chart.set_title({"name": "Pokritost uporabniških postopkov"})
    chart.set_y_axis({"major_unit": 5, "min": 0})
    chart.set_legend({"none": True})
    chart.set_style(10)
    summary.insert_chart("G4", chart, {"x_scale": 1.25, "y_scale": 1.15})

    inventory = workbook.add_worksheet("Inventar")
    inventory.freeze_panes(1, 3)
    inventory.set_row(0, 48)
    widths = [12, 22, 34, 25, 32, 44, 44, 38, 44, 44, 44, 19, 14, 48, 14]
    for column, width in enumerate(widths):
        inventory.set_column(column, column, width)
    for column, header in enumerate(HEADERS):
        inventory.write(0, column, header, header_format)
    for row_number, row in enumerate(rows, start=1):
        values = row_values(row)
        for column, value in enumerate(values):
            fmt = center_format if column in {0, 11, 12, 14} else text_format
            inventory.write(row_number, column, value, fmt)
        inventory.set_row(row_number, 84)

    last_row = len(rows) + 1
    inventory.conditional_format(
        f"L2:L{last_row}",
        {"type": "text", "criteria": "containing", "value": "PRAVILNO", "format": workbook.add_format({"bg_color": pale_green})},
    )
    inventory.conditional_format(
        f"L2:L{last_row}",
        {"type": "text", "criteria": "containing", "value": "DELNO", "format": workbook.add_format({"bg_color": pale_yellow})},
    )
    inventory.conditional_format(
        f"L2:L{last_row}",
        {"type": "text", "criteria": "containing", "value": "MANJKA", "format": workbook.add_format({"bg_color": pale_red})},
    )
    inventory.conditional_format(
        f"L2:L{last_row}",
        {"type": "text", "criteria": "containing", "value": "NAPAČNO", "format": workbook.add_format({"bg_color": pale_red})},
    )
    inventory.conditional_format(
        f"L2:L{last_row}",
        {"type": "text", "criteria": "containing", "value": "NI IMPLEMENTIRANO", "format": workbook.add_format({"bg_color": gray})},
    )
    inventory.conditional_format(
        f"M2:M{last_row}",
        {"type": "text", "criteria": "containing", "value": "KRITIČNO", "format": workbook.add_format({"bg_color": "#F4CCCC", "bold": True})},
    )
    inventory.conditional_format(
        f"M2:M{last_row}",
        {"type": "text", "criteria": "containing", "value": "VISOKO", "format": workbook.add_format({"bg_color": "#FCE5CD"})},
    )
    inventory.add_table(
        0,
        0,
        len(rows),
        len(HEADERS) - 1,
        {
            "name": "SledljivInventar",
            "style": "Table Style Medium 2",
            "columns": [{"header": header} for header in HEADERS],
        },
    )

    gaps = workbook.add_worksheet("Prednostne vrzeli")
    gap_headers = [
        "ID",
        "Pomembnost",
        "Pokritost",
        "Področje",
        "Funkcija",
        "Vrzel oziroma popravek",
        "Dokaz priročnika",
    ]
    gaps.set_row(0, 36)
    gap_widths = [12, 14, 19, 22, 36, 60, 50]
    for column, width in enumerate(gap_widths):
        gaps.set_column(column, column, width)
        gaps.write(0, column, gap_headers[column], header_format)
    priority_rows = [
        row
        for row in rows
        if row["coverage_status"] != "PRAVILNO"
    ]
    severity_rank = {"KRITIČNO": 0, "VISOKO": 1, "SREDNJE": 2, "NIZKO": 3}
    priority_rows.sort(
        key=lambda row: (
            severity_rank.get(str(row["severity"]), 9),
            str(row["domain"]),
            str(row["feature"]),
        )
    )
    for row_number, row in enumerate(priority_rows, start=1):
        values = [
            row["id"],
            row["severity"],
            row["coverage_status"],
            row["domain"],
            row["feature"],
            row["gap_or_correction"],
            list_text(row.get("manual_evidence")),
        ]
        for column, value in enumerate(values):
            gaps.write(row_number, column, value, text_format)
        gaps.set_row(row_number, 72)
    gaps.freeze_panes(1, 0)
    gaps.autofilter(0, 0, len(priority_rows), len(gap_headers) - 1)

    legend = workbook.add_worksheet("Legenda")
    legend.hide_gridlines(2)
    legend.set_column("A:A", 24)
    legend.set_column("B:B", 90)
    legend.write("A1", "Legenda in merila", title_format)
    legend.write("A3", "Status", section_format)
    legend.write("B3", "Pomen", section_format)
    status_explanations = [
        ("PRAVILNO", "Priročnik dovolj natančno opisuje preverjeni uporabniški postopek."),
        ("DELNO", "Funkcija je omenjena, vendar manjka del postopka, napak, posledic ali nastavitev."),
        ("MANJKA", "Implementiran uporabniški postopek v priročniku ni opisan."),
        ("NAPAČNO", "Priročnik nasprotuje preverjenemu vedenju programa."),
        ("NI IMPLEMENTIRANO", "Pričakovana funkcija v pregledani kodi ni bila najdena; priročnik je ne sme predstavljati kot obstoječo."),
    ]
    for row_number, (status, explanation) in enumerate(status_explanations, start=3):
        legend.write(row_number, 0, status, metric_label)
        legend.write(row_number, 1, explanation, text_format)
    legend.write("A11", "Pomembnost", section_format)
    legend.write("B11", "Pomen", section_format)
    severity_explanations = [
        ("KRITIČNO", "Napaka lahko povzroči napačen račun, plačilo, fiskalizacijo, zalogo ali knjižbo."),
        ("VISOKO", "Napaka lahko ustavi pomemben delovni tok ali povzroči težko popravljivo stanje."),
        ("SREDNJE", "Navodilo je potrebno za reden postopek, vendar napaka praviloma nima takojšnjega finančnega učinka."),
        ("NIZKO", "Dopolnitev izboljša uporabnost, razumevanje ali administracijo."),
    ]
    for row_number, (severity, explanation) in enumerate(severity_explanations, start=11):
        legend.write(row_number, 0, severity, metric_label)
        legend.write(row_number, 1, explanation, text_format)
    legend.write("A17", "Vzdrževanje", section_format)
    legend.merge_range(
        "A18:B21",
        "Dokazila so workspace-relative poti z okvirnimi vrsticami. Pred spremembo "
        "priročnika je treba preveriti trenutno kodo, ker se vrstice lahko premaknejo. "
        "Ob spremembi uporabniškega vedenja se posodobijo dokaz, opis postopka in "
        "status pokritosti; datum pregleda mora biti dd.mm.yyyy.",
        note_format,
    )

    workbook.close()


def main() -> None:
    DOCS.mkdir(parents=True, exist_ok=True)
    rows = load_rows()
    write_csv(rows)
    write_markdown(rows)
    write_workbook(rows)
    print(f"{len(rows)} postopkov")
    print(CANONICAL_JSON)
    print(CSV_OUTPUT)
    print(XLSX_OUTPUT)
    print(MD_OUTPUT)


if __name__ == "__main__":
    main()