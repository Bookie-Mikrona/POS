"""Validate and export historical Bookie Old supplier AP closing evidence.

Reads only the supplied invoice-to-native-ledger map and the two old source
exports. Closings are historical evidence, never new payments.
"""

import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLAVNA = ROOT / "attached_assets/5_GLAVNA_1790681786798.txt"
ZAPIRANJE = ROOT / "attached_assets/1_ZAPIRANJE_1790681786792.txt"
AS_OF = "2026-09-29"
CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def money(value):
    return Decimal(value or "0").quantize(CENT, rounding=ROUND_HALF_UP)


def rows(path):
    with path.open(encoding="cp1250", newline="") as stream:
        yield from csv.DictReader(stream, delimiter=";")


def source_reference(row):
    return f"BOOKIE-OLD/K2/{row['Leto']}/{row['Vrsta']}/{row['Stevilka']}"


def export(invoice_map, glavna_rows, closing_rows):
    """Validate the native invoice map and emit one settlement per positive AP invoice."""
    ledger = {str(row["Stevec"]): row for row in glavna_rows
              if row["Zavezanec"] == "000001" and row["S_KONTO"] == "K2"}
    invoice_by_source = {}
    source = {}
    for item in invoice_map:
        reference = item["reference"]
        source_id = str(item["sourceLineId"])
        row = ledger.get(source_id)
        if not row or source_reference(row) != reference:
            raise ValueError(f"Source invoice reference mismatch: {reference}")
        if row["Vrsta"] != "30" or not row["Konto"].startswith("22"):
            raise ValueError(f"Source row is not a supplier AP credit: {reference}")
        original = money(row["Kredit"])
        if original <= ZERO or money(row["Debet"]) != ZERO:
            raise ValueError(f"Invalid positive AP credit source: {reference}")
        if original != money(item["historicalGross"]) or original != money(item["nativeCredit"]):
            raise ValueError(f"Native/source invoice amount mismatch: {reference}")
        if source_id in invoice_by_source:
            raise ValueError(f"Duplicate source invoice line: {source_id}")
        if reference in source:
            raise ValueError(f"Duplicate invoice reference: {reference}")
        invoice_by_source[source_id] = reference
        source[reference] = (row, original)

    raw_links = defaultdict(list)
    for item in closing_rows:
        if item["Zavezanec"] == "000001":
            raw_links[(str(item["Stevec1"]), str(item["Stevec2"]))].append(item)

    links = defaultdict(list)
    closing_ids = set()
    for item in closing_rows:
        if item["Zavezanec"] != "000001":
            continue
        source_id, other_id = str(item["Stevec1"]), str(item["Stevec2"])
        reference = invoice_by_source.get(source_id)
        if not reference:
            continue
        closing_id = str(item["Stevec"])
        if closing_id in closing_ids:
            raise ValueError(f"Duplicate closing ID: {closing_id}")
        closing_ids.add(closing_id)
        amount = money(item["E_Znesek"])
        if amount <= ZERO:
            raise ValueError(f"Non-positive closing amount: {closing_id}")
        forward = raw_links.get((source_id, other_id), [])
        reciprocal = raw_links.get((other_id, source_id), [])
        forward_amounts = Counter(money(row["E_Znesek"]) for row in forward)
        reciprocal_amounts = Counter(money(row["E_Znesek"]) for row in reciprocal)
        if not reciprocal or forward_amounts != reciprocal_amounts:
            raise ValueError(f"Missing or inconsistent reciprocal closing: {closing_id}")
        try:
            recorded = datetime.strptime(item["Datum"], "%m/%d/%Y").date().isoformat()
        except ValueError as error:
            raise ValueError(f"Invalid source date for closing {closing_id}") from error
        evidence = {
            "closingId": closing_id,
            "otherLineId": other_id,
            "amount": str(amount),
            "recordedDate": recorded,
        }
        counterpart = ledger.get(other_id)
        if counterpart:
            evidence["counterpartReference"] = source_reference(counterpart)
        links[source_id].append(evidence)

    settlements = []
    for reference, (row, original) in sorted(source.items()):
        evidence = sorted(links[str(row["Stevec"])], key=lambda item: int(item["closingId"]))
        closed = sum((money(item["amount"]) for item in evidence), ZERO)
        remaining = money(row["Ostanek"])
        if original != closed + remaining:
            raise ValueError(
                f"Closing does not reconcile for {reference}: {original} != {closed}+{remaining}"
            )
        settlements.append({
            "reference": reference,
            "sourceLineId": str(row["Stevec"]),
            "original": str(original),
            "closed": str(closed),
            "remaining": str(remaining),
            "asOf": AS_OF,
            "evidence": evidence,
        })
    return {"asOf": AS_OF, "settlements": settlements}


def main():
    invoice_map = json.load(sys.stdin)
    result = export(invoice_map, list(rows(GLAVNA)), list(rows(ZAPIRANJE)))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()