"""Validated Bookie Old supplier closing evidence for 2026 bank vouchers.

Only reads the old exports. A closing is an historical link, not a new payment.
"""

import csv
import json
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLAVNA = ROOT / "attached_assets/5_GLAVNA_1790681786798.txt"
ZAPIRANJE = ROOT / "attached_assets/1_ZAPIRANJE_1790681786792.txt"


def rows(path):
    with path.open(encoding="cp1250", newline="") as stream:
        yield from csv.DictReader(stream, delimiter=";")


ledger = {
    row["Stevec"]: row
    for row in rows(GLAVNA)
    if row["Zavezanec"] == "000001" and row["S_KONTO"] == "K2"
}
vouchers = defaultdict(list)
for row in ledger.values():
    if row["Leto"] == "2026" and row["Vrsta"] == "10":
        vouchers[f"BOOKIE-OLD/K2/2026/10/{row['Stevilka']}"].append(row)
if len(vouchers) != 114:
    raise ValueError(f"Unexpected 2026 bank voucher count: {len(vouchers)}")

bank_payables = {
    row["Stevec"]: (reference, row)
    for reference, lines in vouchers.items()
    for row in lines
    if row["Konto"].startswith("220")
}
links = list(rows(ZAPIRANJE))
reverse = {(row["Stevec1"], row["Stevec2"]): row for row in links if row["Zavezanec"] == "000001"}
result = []
seen = set()
for row in links:
    if row["Zavezanec"] != "000001" or row["Stevec2"] not in bank_payables:
        continue
    invoice = ledger.get(row["Stevec1"])
    if not invoice or invoice["Vrsta"] != "30" or not invoice["Konto"].startswith("220"):
        continue
    reference, bank_line = bank_payables[row["Stevec2"]]
    opposite = reverse.get((row["Stevec2"], row["Stevec1"]))
    if not opposite or opposite["E_Znesek"] != row["E_Znesek"] or row["Stevec"] in seen:
        raise ValueError(f"Missing, inconsistent or duplicate paired closing: {row['Stevec']}")
    seen.add(row["Stevec"])
    amount = Decimal(row["E_Znesek"])
    original = Decimal(invoice["Kredit"])
    bank_amount = Decimal(bank_line["Debet"] or "0")
    if amount <= 0 or original <= 0 or bank_amount <= 0 or amount > original:
        raise ValueError(f"Invalid supplier amount: {row['Stevec']}")
    recorded = datetime.strptime(row["Datum"], "%m/%d/%Y").date().isoformat()
    if recorded != datetime.strptime(bank_line["Dat_dok"], "%m/%d/%Y").date().isoformat():
        raise ValueError(f"Bank date mismatch: {row['Stevec']}")
    result.append({
        "closingId": row["Stevec"],
        "statementReference": reference,
        "invoiceReference": f"BOOKIE-OLD/K2/{invoice['Leto']}/30/{invoice['Stevilka']}",
        "sourceBankLineId": bank_line["Stevec"],
        "sourceInvoiceLineId": invoice["Stevec"],
        "invoiceOriginal": str(original.quantize(Decimal("0.01"))),
        "amount": str(amount.quantize(Decimal("0.01"))),
        "recordedDate": recorded,
    })

if len(result) != 53 or len({r["statementReference"] for r in result}) != 24:
    raise ValueError("Unexpected supplier closing coverage in 2026")
per_bank_line = defaultdict(Decimal)
for item in result:
    per_bank_line[item["sourceBankLineId"]] += Decimal(item["amount"])
for line_id, total in per_bank_line.items():
    if total != Decimal(bank_payables[line_id][1]["Debet"]):
        raise ValueError(f"Supplier bank line does not reconcile: {line_id}")

print(json.dumps({
    "statementReferences": sorted(vouchers),
    "closings": sorted(result, key=lambda item: int(item["closingId"])),
}))