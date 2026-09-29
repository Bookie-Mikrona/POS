"""Compare the two submitted 2025 statements with the mapped development ledger.

Read-only: never posts, updates or adjusts a journal entry. Run from repo root.
"""

import csv
import os
import re
import subprocess
from collections import defaultdict
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CENT = Decimal("0.01")
PDF_AMOUNT = r"-?[\d.]+,\d{2}"
OLD_CODE = r"\d{7}"
COMPANY_ID = "80acfaf9-fd18-4e0a-8f03-bffbb2558893"
FIELDS = ("otv_d", "otv_c", "otv_net", "prom_d", "prom_c", "prom_net", "all_d", "all_c", "all_net")


def money(value: str) -> Decimal:
    return Decimal(value.replace(".", "").replace(",", "."))


def pdf_rows(filename: str, columns: int) -> dict[str, tuple[Decimal, ...]]:
    text = subprocess.check_output(
        ["pdftotext", "-layout", str(ROOT / "attached_assets" / filename), "-"],
        text=True,
    )
    number_columns = r"\s+".join([f"({PDF_AMOUNT})"] * columns)
    pattern = re.compile(rf"^\s*({OLD_CODE})\s+.+?\s+({number_columns})\s*$")
    result: dict[str, tuple[Decimal, ...]] = {}
    for line in text.splitlines():
        match = pattern.match(line)
        if match:
            if match[1] in result:
                raise ValueError(f"Podvojen konto v PDF: {match[1]}")
            result[match[1]] = tuple(money(match[i]) for i in range(3, columns + 3))
    return result


def database_rows() -> dict[str, tuple[Decimal, ...]]:
    sql = f"""
        SELECT a.code,
          SUM(CASE WHEN j.reference LIKE 'BOOKIE-OLD/K2/2025/00/%' AND l.side = 'debit' THEN l.amount::numeric ELSE 0 END),
          SUM(CASE WHEN j.reference LIKE 'BOOKIE-OLD/K2/2025/00/%' AND l.side = 'credit' THEN l.amount::numeric ELSE 0 END),
          SUM(CASE WHEN j.reference NOT LIKE 'BOOKIE-OLD/K2/2025/00/%' AND l.side = 'debit' THEN l.amount::numeric ELSE 0 END),
          SUM(CASE WHEN j.reference NOT LIKE 'BOOKIE-OLD/K2/2025/00/%' AND l.side = 'credit' THEN l.amount::numeric ELSE 0 END)
        FROM journal_entries j
        JOIN journal_entry_lines l ON l.entry_id = j.id
        JOIN accounts a ON a.id = l.account_id
        WHERE j.company_id = '{COMPANY_ID}'
          AND j.entry_date BETWEEN '2025-01-01' AND '2025-12-31'
          AND j.status IN ('posted','reversed')
        GROUP BY a.code ORDER BY a.code
    """
    env = dict(os.environ, PGOPTIONS="-c default_transaction_read_only=on")
    output = subprocess.check_output(
        ["psql", "-X", "-t", "-A", "-F", "|", "-c", sql], env=env, text=True
    )
    rows = {}
    for line in output.splitlines():
        code, od, oc, td, tc = line.split("|")
        opening_d, opening_c, turnover_d, turnover_c = map(Decimal, (od, oc, td, tc))
        rows[code] = (
            opening_d, opening_c, opening_d - opening_c,
            turnover_d, turnover_c, turnover_d - turnover_c,
            opening_d + turnover_d, opening_c + turnover_c,
            opening_d + turnover_d - opening_c - turnover_c,
        )
    return rows


def main() -> None:
    mapping = {
        row["stari_konto"]: row["ciljni_konto"]
        for row in csv.DictReader(
            (ROOT / "reports/bookie-old-K2-finalna-preslikava-2020plus.csv").open(encoding="utf-8-sig"),
            delimiter=";",
        )
    }
    bilanca = pdf_rows("Bilanca(4)_1790715996751.PDF", 3)
    zaklj = pdf_rows("zaklj_rac_1790716113543.PDF", 9)
    if len(bilanca) != 65 or len(zaklj) != 65 or set(bilanca) != set(zaklj):
        raise ValueError(f"Nepričakovan nabor PDF kontov: Bilanca {len(bilanca)}, Zaključni račun {len(zaklj)}")
    expected = defaultdict(lambda: [Decimal("0")] * 9)
    sources: dict[str, list[str]] = defaultdict(list)
    for old_code, amounts in zaklj.items():
        if amounts[6:] != bilanca[old_code]:
            raise ValueError(f"PDF-ja se ne ujemata na kontu {old_code}")
        target = mapping[old_code]
        sources[target].append(old_code)
        expected[target] = [x + y for x, y in zip(expected[target], amounts)]

    actual = database_rows()
    if set(actual) != set(expected):
        raise ValueError(f"Različni konti po preslikavi: manjkajo {sorted(set(expected)-set(actual))}; novi {sorted(set(actual)-set(expected))}")
    output = ROOT / "reports/mikrona-2025-pdf-gk-reconciliation.csv"
    mismatches = []
    with output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["stari_konti", "novi_konto", *[f"pdf_{field}" for field in FIELDS], *[f"gk_{field}" for field in FIELDS], "ujemanje"])
        for code in sorted(expected):
            pdf_values = tuple(x.quantize(CENT) for x in expected[code])
            db_values = tuple(x.quantize(CENT) for x in actual[code])
            ok = pdf_values == db_values
            writer.writerow(["+".join(sources[code]), code, *pdf_values, *db_values, "DA" if ok else "NE"])
            if not ok:
                mismatches.append(code)
    totals = [sum((actual[code][i] for code in actual), Decimal("0")) for i in range(9)]
    print(f"{len(zaklj)} izvornih kontov -> {len(actual)} ciljnih, razlik: {len(mismatches)}")
    print(f"Otvoritev D/K {totals[0]}/{totals[1]}; promet D/K {totals[3]}/{totals[4]}; skupaj D/K {totals[6]}/{totals[7]}")
    print(f"Primerjava: {output}")
    if mismatches:
        raise ValueError(f"Neujemanje na ciljnih kontih: {mismatches}")


if __name__ == "__main__":
    main()