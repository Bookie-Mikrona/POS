"""Read-only Bookie Old AR settlement evidence, scoped to Mikrona K2.

Zapiranje stores both directions of a link. Only Stevec1=the original
invoice's GLAVNA AR line is counted, so each closing is counted once.
The snapshot is historical evidence, NOT a new bank payment.
"""

import csv
import json
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLAVNA = ROOT / "attached_assets/5_GLAVNA_1790681786798.txt"
ZAPIRANJE = ROOT / "attached_assets/1_ZAPIRANJE_1790681786792.txt"
CENT = Decimal("0.01")
ZERO = Decimal("0.00")
AS_OF = "2026-09-29"


def money(value):
    return Decimal(value or "0").quantize(CENT, rounding=ROUND_HALF_UP)


def rows(path):
    with path.open(encoding="cp1250", newline="") as stream:
        yield from csv.DictReader(stream, delimiter=";")


source = {}
for row in rows(GLAVNA):
    if (
        row["Zavezanec"] == "000001"
        and row["S_KONTO"] == "K2"
        and row["Konto"] == "1200000"
        and row["Vrsta"] == "60"
        and row["Leto"] in {str(y) for y in range(2020, 2027)}
        and money(row["Debet"]) > ZERO
    ):
        ref = f"BOOKIE-OLD/K2/{row['Leto']}/60/{row['Stevilka']}"
        if ref in source:
            raise ValueError(f"Multiple positive AR source lines: {ref}")
        source[ref] = row

if len(source) != 1660:
    raise ValueError(f"Unexpected invoice AR source count: {len(source)}")

by_source_id = {row["Stevec"]: ref for ref, row in source.items()}
links = defaultdict(list)
seen_closing_ids = set()
for row in rows(ZAPIRANJE):
    if row["Zavezanec"] != "000001" or row["Stevec1"] not in by_source_id:
        continue
    if row["Stevec"] in seen_closing_ids:
        raise ValueError(f"Duplicate closing evidence: {row['Stevec']}")
    seen_closing_ids.add(row["Stevec"])
    links[row["Stevec1"]].append({
        "closingId": row["Stevec"],
        "otherLineId": row["Stevec2"],
        "amount": str(money(row["E_Znesek"])),
        "recordedDate": row["Datum"],
    })

result = []
for ref, row in sorted(source.items()):
    original = money(row["Debet"])
    closed = sum((money(link["amount"]) for link in links[row["Stevec"]]), ZERO)
    remaining = money(row["Ostanek"])
    if original != closed + remaining:
        raise ValueError(f"Closing does not reconcile for {ref}: {original} != {closed}+{remaining}")
    # A legacy offsetting +48.80/-48.80 voucher has a net-zero invoice in
    # the new ERP. It is fully closed and has no receivable to transfer.
    if ref == "BOOKIE-OLD/K2/2021/60/000273":
        if remaining != ZERO:
            raise ValueError("The net-zero exception gained an open balance")
        continue
    result.append({
        "reference": ref,
        "sourceLineId": row["Stevec"],
        "original": str(original),
        "closed": str(closed),
        "remaining": str(remaining),
        "asOf": AS_OF,
        "evidence": sorted(links[row["Stevec"]], key=lambda item: item["closingId"]),
    })

open_items = [item for item in result if money(item["remaining"]) > ZERO]
if len(result) != 1659 or len(open_items) != 64:
    raise ValueError("Unexpected historical receivable scope")
if sum((money(item["remaining"]) for item in open_items), ZERO) != Decimal("8711.44"):
    raise ValueError("Historical open debit does not match old IOP")
if sum((money(item["remaining"]) for item in open_items if "/2026/" in item["reference"]), ZERO) != Decimal("4100.24"):
    raise ValueError("Historical draft debit does not match old IOP")

print(json.dumps({"asOf": AS_OF, "settlements": result}, ensure_ascii=False))