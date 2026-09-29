"""Strog, samo-bralni izvoz knjižb Bookie Old K2 v uvozno strukturo.

GLAVNA je vir GK knjižb; Promet in Ziro nista izvor popolnih računov oziroma
bančnih izpiskov. Izpis je JSON na stdout, brez sprememb podatkov.
"""

import csv
import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
YEARS = {str(year) for year in range(2020, 2027)}
ZERO = Decimal("0.00")


def source_csv(path, encoding="cp1250", **kwargs):
    with (ROOT / path).open(encoding=encoding, newline="") as stream:
        yield from csv.DictReader(stream, delimiter=";", **kwargs)


def date(raw):
    if not raw:
        return None
    return datetime.strptime(raw, "%m/%d/%Y").date().isoformat()


mapping = {
    row["stari_konto"]: row["ciljni_konto"]
    for row in source_csv(
        "reports/bookie-old-K2-finalna-preslikava-2020plus.csv",
        encoding="utf-8-sig",
    )
}
if len(mapping) != 108:
    raise ValueError("Nepričakovano število preslikav")

partner_master = {row["Sifra"]: row for row in source_csv("attached_assets/4_Partner_1790681786796.txt")}
vouchers = {}
used_partners = set()
missing_partners = Counter()
source_ids = set()
totals = defaultdict(lambda: {"debit": ZERO, "credit": ZERO, "rows": 0})
zero_lines = 0
source_rows = 0

for row in source_csv("attached_assets/5_GLAVNA_1790681786798.txt"):
    if row["Zavezanec"] != "000001" or row["Leto"] not in YEARS or row["S_KONTO"] != "K2":
        continue
    source_rows += 1
    old_code = row["Konto"]
    if old_code not in mapping:
        raise ValueError(f"Nepreslikan konto {old_code}, GLAVNA {row['Stevec']}")
    source_id = row["Stevec"]
    if source_id in source_ids:
        raise ValueError(f"Podvojeni števec GLAVNA {source_id}")
    source_ids.add(source_id)
    key = (row["Leto"], row["Vrsta"], row["Stevilka"])
    document_date = date(row["Dat_dok"])
    entry_date = date(row["Dat_knj"])
    if not entry_date or not document_date or entry_date[:4] != row["Leto"]:
        raise ValueError(f"Manjka datum ali napačno leto: {key}, GLAVNA {source_id}")
    if key not in vouchers:
        vouchers[key] = {
            "year": row["Leto"],
            "type": row["Vrsta"],
            "number": row["Stevilka"],
            "entryDate": entry_date,
            "documentDate": document_date,
            "taxDate": None,
            "receiptDate": None,
            "lines": [],
            "sourceRows": 0,
            "rawDifference": "0.00",
        }
    voucher = vouchers[key]
    if voucher["entryDate"] != entry_date or voucher["documentDate"] != document_date:
        raise ValueError(f"Različni datumi znotraj temeljnice {key}")
    for target, raw in (("taxDate", row["Dat_DDV"]), ("receiptDate", row["Dat_pre"])):
        value = date(raw)
        if value and voucher[target] and value != voucher[target]:
            raise ValueError(f"Različni datumi {target} znotraj temeljnice {key}")
        if value:
            voucher[target] = value
    voucher["sourceRows"] += 1
    partner = row["Partner"] or None
    if partner:
        if partner in partner_master:
            used_partners.add(partner)
        else:
            missing_partners[partner] += 1
    debit = Decimal(row["Debet"] or "0")
    credit = Decimal(row["Kredit"] or "0")
    for raw_amount in (debit, credit):
        if raw_amount.as_tuple().exponent < -2:
            raise ValueError(f"Več kot 2 decimalki na GLAVNA {source_id}")
    totals[(row["Leto"], row["Vrsta"])]["debit"] += debit
    totals[(row["Leto"], row["Vrsta"])]["credit"] += credit
    totals[(row["Leto"], row["Vrsta"])]["rows"] += 1
    voucher["rawDifference"] = str(Decimal(voucher["rawDifference"]) + debit - credit)
    if not debit and not credit:
        zero_lines += 1
        raise ValueError(f"Ničelna vrstica GLAVNA {source_id}")
    for original_side, amount in (("debit", debit), ("credit", credit)):
        if amount == 0:
            continue
        side = original_side if amount > 0 else ("credit" if original_side == "debit" else "debit")
        line = {
            "accountCode": mapping[old_code],
            "sourceAccountCode": old_code,
            "side": side,
            "amount": str(abs(amount).quantize(Decimal("0.01"))),
            "partnerCode": partner if partner in partner_master else None,
            "sourcePartnerName": row["Naziv"].strip() or None,
            "sourceId": source_id,
            "description": (row["Besedilo"] or "")[:250],
            "unresolvedPartnerCode": partner if partner and partner not in partner_master else None,
        }
        voucher["lines"].append(line)

if source_rows != 12514 or len(vouchers) != 3645:
    raise ValueError(f"Obseg izvoza se je spremenil: {source_rows} vrstic, {len(vouchers)} temeljnic")

type_names = {
    "00": "otvoritev",
    "10": "bančni izpisek",
    "30": "prejeti račun",
    "60": "izdani račun",
}
imbalances = []
for key, voucher in vouchers.items():
    debit = sum((Decimal(line["amount"]) for line in voucher["lines"] if line["side"] == "debit"), ZERO)
    credit = sum((Decimal(line["amount"]) for line in voucher["lines"] if line["side"] == "credit"), ZERO)
    if debit - credit != Decimal(voucher["rawDifference"]):
        raise ValueError(f"Neujemanje izvornih in pretvorjenih zneskov: {key}")
    if debit != credit:
        imbalances.append({"year": key[0], "type": key[1], "number": key[2], "difference": str(debit - credit)})
    voucher["reference"] = f"BOOKIE-OLD/K2/{key[0]}/{key[1]}/{key[2]}"
    voucher["description"] = f"Bookie Old K2 – {type_names.get(key[1], 'vrsta ' + key[1])} {key[0]}/{key[2]}"
    voucher["sourceDebit"] = str(debit)
    voucher["sourceCredit"] = str(credit)

if len(imbalances) != 15 or any(row["year"] != "2026" or row["type"] != "10" for row in imbalances):
    raise ValueError(f"Nepričakovano število/vrsta neuravnoteženih temeljnic: {imbalances}")
if sum((Decimal(row["difference"]) for row in imbalances), ZERO) != Decimal("-1959.94"):
    raise ValueError("Nepričakovana razlika 2026")

partners_by_identity = {}
for code in sorted(used_partners):
    row = partner_master[code]
    if not row["Naziv"].strip():
        raise ValueError(f"Partner {code} nima naziva")
    tax_digits = re.sub(r"\D", "", row["Davcna"])
    # Ciljna tabela ima unique indeks na davčni številki brez nedigitalnih
    # znakov. Stari šifri iste davčne osebe povežemo, izvirno ime ostane pri
    # knjižbeni vrstici.
    identity = f"tax:{tax_digits}" if tax_digits else f"code:{code}"
    if identity in partners_by_identity:
        partners_by_identity[identity]["sourceCodes"].append(code)
        continue
    partners_by_identity[identity] = {
        "code": code,
        "sourceCodes": [code],
        "name": row["Naziv"].strip(),
        "taxId": row["Davcna"].strip() or None,
        "address": row["Ulica"].strip() or None,
        "postCode": row["Posta"].strip() or None,
        "city": row["Kraj"].strip() or None,
    }
partners = list(partners_by_identity.values())

print(json.dumps({
    "companyOld": "000001",
    "vouchers": [vouchers[key] for key in sorted(vouchers)],
    "partners": partners,
    "unresolvedPartners": dict(missing_partners),
    "imbalances": imbalances,
    "controlTotals": [
        {"year": year, "type": kind, "debit": str(v["debit"]), "credit": str(v["credit"]), "sourceRows": v["rows"]}
        for (year, kind), v in sorted(totals.items())
    ],
    "sourceRows": source_rows,
    "zeroLines": zero_lines,
}, ensure_ascii=False))