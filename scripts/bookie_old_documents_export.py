"""Bralni izvoz listin Bookie Old K2. Promet1 je vir izdanih postavk.

Izpis NE ustvarja knjižb. Zneski na izdanih postavkah so iz Vre_pro/Vre_DDV,
ne iz Koli*Pro (stara aplikacija je omogočala popuste in popravke).
"""
import csv
import json
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
YEARS = {str(y) for y in range(2020, 2027)}
Z = Decimal("0.00")


def read(name, encoding="cp1250"):
    with (ROOT / "attached_assets" / name).open(encoding=encoding, newline="") as f:
        yield from csv.DictReader(f, delimiter=";")


def amount(raw):
    value = Decimal(raw or "0")
    if value.as_tuple().exponent < -2:
        raise ValueError(f"Znesek z več kot dvema decimalama: {raw}")
    return value


def day(raw):
    return datetime.strptime(raw, "%m/%d/%Y").date().isoformat() if raw else None


promet = {}
for row in read("2_Promet_1790681786794.txt"):
    if row["Zavezanec"] != "000001" or row["Leto"] not in YEARS or row["Vrsta"] not in ("10", "30", "60"):
        continue
    key = (row["Leto"], row["Vrsta"], row["Stevilka"])
    if key in promet:
        raise ValueError(f"Podvojena glava {key}")
    promet[key] = row

details = defaultdict(list)
source_ids = set()
for row in read("Promet1_1790688558815.txt", "cp852"):
    if row["Zavezanec"] != "000001" or row["Leto"] not in YEARS or row["Vrsta"] != "60":
        continue
    key = (row["Leto"], row["Vrsta"], row["Stevilka"])
    if row["Stevec"] in source_ids:
        raise ValueError(f"Podvojena postavka {row['Stevec']}")
    source_ids.add(row["Stevec"])
    details[key].append(row)

ledger = defaultdict(list)
for row in read("5_GLAVNA_1790681786798.txt"):
    if row["Zavezanec"] == "000001" and row["Leto"] in YEARS and row["S_KONTO"] == "K2" and row["Vrsta"] in ("10", "30", "60"):
        ledger[(row["Leto"], row["Vrsta"], row["Stevilka"])].append(row)

if len(promet) != 3533 or len(details) != 1672 or len(source_ids) != 1742:
    raise ValueError(f"Spremenjen obseg: Promet {len(promet)}, izdani {len(details)}, postavke {len(source_ids)}")
if {k for k in promet if k[1] == "60"} != set(details):
    raise ValueError("Glave in postavke izdanih računov se ne ujemajo")
if len([k for k in promet if k[1] == "30"]) != 757 or len([k for k in promet if k[1] == "10"]) != 1104:
    raise ValueError("Spremenjen obseg prejetih računov ali banke")

invoices = []
statements = []
for key, head in sorted(promet.items()):
    year, kind, number = key
    rows = ledger[key]
    ref = f"BOOKIE-OLD/K2/{year}/{kind}/{number}"
    if kind == "10":
        bank = [r for r in rows if r["Konto"] == "1100000"]
        statements.append({
            "reference": ref, "year": year, "number": number,
            "date": day(head["Datum"]), "hasLedger": bool(rows),
            "lines": [
                {"sourceId": r["Stevec"], "date": day(r["Dat_knj"]),
                 "amount": str(amount(r["Debet"]) - amount(r["Kredit"])),
                 "description": r["Besedilo"].strip(), "counterpartyName": r["Naziv"].strip()}
                for r in bank
            ],
        })
        continue
    ar_prefixes = ("220", "221") if kind == "30" else ("120", "121")
    ar = [r for r in rows if r["Konto"].startswith(ar_prefixes) and r["Partner"]]
    partner = ar[0]["Partner"] if ar else head["Partner"]
    if not partner:
        raise ValueError(f"Manjka partner {ref}")
    if ar and any(r["Partner"] != partner for r in ar):
        raise ValueError(f"Več partnerjev na računu {ref}")
    result = {
        "reference": ref, "year": year, "kind": kind, "number": number,
        "invoiceNumber": head["Stevilka1"].strip(),
        "date": day(head["Datum"]), "dueDate": day(head["Datum1"]) if kind == "60" else None,
        "partner": partner, "arCode": ar[0]["Konto"] if ar else "1200000",
        "revenueCode": next((r["Konto"] for r in rows
                             if r["Konto"].startswith("7") and amount(r["Kredit"]) != 0), None),
        "hasLedger": bool(rows), "lines": [], "net": None, "vat": None, "gross": None,
        "warnings": [],
    }
    if not result["invoiceNumber"] or not result["date"]:
        raise ValueError(f"Manjka številka ali datum {ref}")
    if kind == "60":
        for row in details[key]:
            if row["Partner"] and row["Partner"] != partner:
                raise ValueError(f"Postavka drugega partnerja {ref}")
            net, vat = amount(row["Vre_pro"]), amount(row["Vre_DDV"])
            result["lines"].append({
                "sourceId": row["Stevec"], "description": row["Naziv"].strip(),
                "article": row["Artikel"].strip(), "quantity": row["Koli"],
                "listPrice": row["Pro"], "net": str(net), "vat": str(vat),
                "vatRate": row["DDV"], "sourceAccount": row["F_Konto"].strip(),
            })
        net = sum((Decimal(r["net"]) for r in result["lines"]), Z)
        vat = sum((Decimal(r["vat"]) for r in result["lines"]), Z)
        gross = net + vat
        if rows:
            ar_total = sum((amount(r["Debet"]) - amount(r["Kredit"]) for r in ar), Z)
            if ar_total != gross:
                result["warnings"].append(f"Razlika med postavkami in terjatvijo GK: {gross - ar_total:+.2f} EUR")
        else:
            result["warnings"].append("Brez temeljnice GK: izvorni račun je neknjižen")
    else:
        if not ar:
            raise ValueError(f"Prejeti račun brez obveznosti/partnerja {ref}")
        signed = sum((amount(r["Kredit"]) - amount(r["Debet"]) for r in ar), Z)
        positive = sum((max(amount(r["Kredit"]), Z) for r in ar), Z)
        net = sum((
            amount(r["Debet"]) - amount(r["Kredit"])
            for r in rows if r["Konto"][0] in "03467"
        ), Z)
        gross = positive if signed == 0 and positive > 0 and net > 0 else signed
        vat = gross - net
        input_vat = sum((amount(r["Debet"]) - amount(r["Kredit"]) for r in rows if r["Konto"].startswith("160")), Z)
        if vat != input_vat:
            if vat == 0 and input_vat > 0:
                result["warnings"].append("Samoobdavčitev v GK: DDV ni zaračunan na računu")
            else:
                result["warnings"].append(f"DDV zahteva pregled: razlika bruto−osnova {vat}, konto 160 {input_vat}")
                # V tem primeru razčlenitev osnove/DDV ni dokazana. Bruto iz
                # obveznosti je znan, vendar napačnih neto/DDV zneskov ne izvozimo.
                net, vat = None, None
        if net == 0 and gross != 0:
            result["warnings"].append("Ni razvidne finančne osnove; preveri povezano temeljnico")
    result.update(net=str(net) if net is not None else None,
                  vat=str(vat) if vat is not None else None, gross=str(gross))
    invoices.append(result)

print(json.dumps({"invoices": invoices, "statements": statements}, ensure_ascii=False))