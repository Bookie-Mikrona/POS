"""Read-only source export for native Bookie Old GLAVNA/ZAPIRANJE provenance."""

import csv
import hashlib
import json
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLAVNA_PATH = ROOT / "attached_assets/5_GLAVNA_1790681786798.txt"
ZAP_PATH = ROOT / "attached_assets/1_ZAPIRANJE_1790681786792.txt"
CENT = Decimal("0.01")


def rows(path):
    with path.open(encoding="cp1250", newline="") as stream:
        yield from csv.DictReader(stream, delimiter=";")


def date(raw):
    if not raw or raw == "0/0/0000":
        return None
    parsed = datetime.strptime(raw, "%m/%d/%Y").date()
    return parsed.isoformat() if parsed.year >= 1900 else None


def money(raw):
    value = Decimal(raw or "0")
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def source_money(raw):
    value = Decimal(raw or "0")
    if value.as_tuple().exponent < -2:
        raise ValueError(f"Znesek ima več kot dve decimalki: {raw}")
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


gl_rows = [row for row in rows(GLAVNA_PATH) if row["Zavezanec"] == "000001"]
gl_by_id = {}
for row in gl_rows:
    source_id = row["Stevec"]
    if source_id in gl_by_id:
        raise ValueError(f"Podvojen izvorni GLAVNA ID: {source_id}")
    gl_by_id[source_id] = row


def gl_proof(row):
    debit, credit = source_money(row["Debet"]), source_money(row["Kredit"])
    if not debit and not credit:
        raise ValueError(f"GLAVNA {row['Stevec']} ima ničelni znesek")
    sides = []
    for original_side, raw_amount in (("debit", debit), ("credit", credit)):
        if not raw_amount:
            continue
        side = original_side if raw_amount > 0 else ("credit" if original_side == "debit" else "debit")
        sides.append({"side": side, "amount": f"{abs(raw_amount):.2f}"})
    return {
        "sourceLineId": row["Stevec"],
        "year": row["Leto"],
        "type": row["Vrsta"],
        "voucherNumber": row["Stevilka"],
        "documentNumber": row["Stevilka"],
        "ledgerCode": row["S_KONTO"],
        "accountCode": row["Konto"],
        "partnerCode": row["Partner"] or None,
        "partnerName": row["Naziv"].strip() or None,
        "description": row["Besedilo"],
        "sides": sides,
        "documentDate": date(row["Dat_dok"]),
        "postingDate": date(row["Dat_knj"]),
        "durDate": date(row["Dat_dur"]),
        "dueDate": date(row["Dat_zap"]),
        "taxDate": date(row["Dat_DDV"]),
    }


native_source_rows = [
    row for row in gl_rows
    if row["S_KONTO"] == "K2" and "2020" <= row["Leto"] <= "2025"
]
native_sources = {row["Stevec"]: row for row in native_source_rows}
if len(native_sources) != len(native_source_rows):
    raise ValueError("Podvojena GLAVNA identiteta v uvoženem obsegu")

native_lines = []
for row in native_source_rows:
    proof = gl_proof(row)
    for side in proof["sides"]:
        native_lines.append({
            **proof,
            **side,
            "originalDebit": f"{source_money(row['Debet']):.2f}",
            "originalCredit": f"{source_money(row['Kredit']):.2f}",
            "reference": f"BOOKIE-OLD/K2/{row['Leto']}/{row['Vrsta']}/{row['Stevilka']}",
        })

by_anchor = {source_id: [] for source_id in native_sources}
relevant_zap = []
zap_ids = set()
zero_closings = 0
negative_closings = 0
for row in rows(ZAP_PATH):
    if row["Zavezanec"] != "000001":
        continue
    source_id, other_id = row["Stevec1"], row["Stevec2"]
    if source_id not in native_sources and other_id not in native_sources:
        continue
    closing_id = row["Stevec"]
    if closing_id in zap_ids:
        raise ValueError(f"Podvojen izvorni ZAPIRANJE ID: {closing_id}")
    zap_ids.add(closing_id)
    amount = money(row["E_Znesek"])
    if amount == 0:
        zero_closings += 1
        continue
    if amount < 0:
        negative_closings += 1
        continue
    source_gl = gl_by_id.get(source_id)
    other_gl = gl_by_id.get(other_id)
    if not source_gl or not other_gl:
        raise ValueError(f"ZAPIRANJE {closing_id} nima obeh izvornih GL dokazov: {source_id}/{other_id}")
    source_proof, other_proof = gl_proof(source_gl), gl_proof(other_gl)
    if not any(
        source_side["side"] != other_side["side"]
        and source_proof["accountCode"] == other_proof["accountCode"]
        and source_proof["partnerCode"] == other_proof["partnerCode"]
        for source_side in source_proof["sides"] for other_side in other_proof["sides"]
    ):
        raise ValueError(f"ZAPIRANJE {closing_id} povezuje isti GK strani")
    evidence = {
        "closingId": closing_id,
        "sourceLineId": source_id,
        "otherSourceLineId": other_id,
        "amount": f"{amount:.2f}",
        "recordedDate": date(row["Datum"]),
        "sourceProof": source_proof,
        "counterpartProof": other_proof,
    }
    relevant_zap.append(evidence)
    if source_id in native_sources:
        by_anchor[source_id].append({**evidence, "anchorSide": "source"})
    if other_id in native_sources:
        by_anchor[other_id].append({**evidence, "anchorSide": "counterpart"})

digest = hashlib.sha256(
    GLAVNA_PATH.read_bytes() + b"\0BOOKIE-OLD-ZAP\0" + ZAP_PATH.read_bytes()
).hexdigest()

print(json.dumps({
    "companyOld": "000001",
    "years": "2020-2025",
    "sourceDigest": digest,
    "nativeLines": native_lines,
    "closings": relevant_zap,
    "zeroClosings": zero_closings,
    "negativeClosings": negative_closings,
    "byNativeSourceLine": by_anchor,
}, ensure_ascii=False))