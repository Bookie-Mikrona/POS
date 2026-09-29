"""Iz potrjene preglednice pripravi sledljivo preslikavo Bookie Old K2 (2020+).

Ne knjiži temeljnic in ne spreminja baze. Izpis JSON je namenjen kontroliranemu
enkratnemu vnosu kontov; CSV je revizijska sled odločitve.
"""

import csv
import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

SOURCE = Path("reports/bookie-old-K2-preslikava-2020plus.xlsx")
OUTPUT = Path("reports/bookie-old-K2-finalna-preslikava-2020plus.csv")
NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

# Šifre že obstajajo z drugim pomenom. Obstoječih kontov ne spreminjamo.
COLLISIONS = {
    "0400000", "0500000", "1201000", "1611000", "1901000",
    "2201000", "2210000", "2211000", "2300000", "2851000",
    "4022000", "4120000", "4151000", "4160000", "4192000",
    "7000000", "7403000", "7701000", "8000000", "8100000",
}
# 2851001–2851004 so že stare šifre brez predloga, zato ostanejo zanje.
SPECIAL_ALTERNATES = {"2851000": "2851005"}
# Razred 7 vsebuje tudi odhodkovne konte; številka sama ne določa vrste.
EXPENSE_7 = {"7000000", "7403000", "7546000", "7580000", "7404000", "7230000"}


def source_rows():
    with zipfile.ZipFile(SOURCE) as archive:
        strings = [
            "".join(item.itertext())
            for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))
        ]
        root = ET.fromstring(archive.read("xl/worksheets/sheet2.xml"))
        for row in root.findall(".//a:sheetData/a:row", NS)[1:]:
            values = {}
            for cell in row:
                raw = cell.findtext("a:v", default="", namespaces=NS)
                column = "".join(char for char in cell.attrib["r"] if char.isalpha())
                values[column] = strings[int(raw)] if cell.get("t") == "s" and raw else raw
            yield values


def account_type(old_code):
    if old_code in EXPENSE_7:
        return "expense"
    return {
        "0": "asset", "1": "asset", "2": "liability",
        "3": "asset", "4": "expense", "6": "expense",
        "7": "revenue", "8": "equity", "9": "equity",
    }[old_code[0]]


def build_mapping():
    sources = list(source_rows())
    assert len(sources) == 108, "Obseg preglednice se je spremenil"
    old_codes = {item["A"] for item in sources}
    assert len(old_codes) == 108 and COLLISIONS <= old_codes
    used = set(old_codes)
    result = []
    for item in sources:
        old = item["A"]
        proposed = item.get("H", "")
        if proposed:
            target, decision = proposed, "potrjen predlog"
        elif old in COLLISIONS:
            target = SPECIAL_ALTERNATES.get(old, old[:3] + f"{int(old[3:]) + 1:04d}")
            decision = "nov konto – nadomestna šifra zaradi kolizije"
        else:
            target, decision = old, "nov konto – izvorna šifra"
        if not proposed:
            assert target not in used or target == old, f"Kolizija ciljne šifre: {target}"
            used.add(target)
        result.append({
            "stari_konto": old,
            "stari_naziv_k2": item["B"],
            "ciljni_konto": target,
            "odločitev": decision,
            "vrsta_novega_konta": "" if proposed else account_type(old),
            "vrstic_2020_plus": int(item["C"]),
        })
    assert sum(bool(item.get("H")) for item in sources) == 27
    assert len({row["ciljni_konto"] for row in result}) == len(result), (
        "Podvojena ciljna šifra zahteva ročno preverbo"
    )
    return result


if __name__ == "__main__":
    mapping = build_mapping()
    if "--json" in sys.argv:
        print(json.dumps(mapping, ensure_ascii=False))
    else:
        with OUTPUT.open("w", encoding="utf-8-sig", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=mapping[0].keys(), delimiter=";")
            writer.writeheader()
            writer.writerows(mapping)
        print(OUTPUT)