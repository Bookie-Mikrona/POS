"""Extract reference card rows using their visual column positions."""

import argparse
import json
import re
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import pymupdf


def amount(text: str) -> Decimal:
    return Decimal(text.replace(".", "").replace(",", ".")) if text else Decimal(0)


def extract(path: Path) -> list[dict]:
    rows = []
    with pymupdf.open(path) as document:
        for page_number, page in enumerate(document, start=1):
            words = []
            for word in page.get_text("words"):
                rect = pymupdf.Rect(word[:4]) * page.rotation_matrix
                words.append((rect.x0, rect.y0, word[4]))
            words.sort(key=lambda word: (round(word[1], 1), word[0]))
            header_y = next(y for x, y, text in words if x < 59 and text == "Vr.")
            anchors = sorted(
                (y, text)
                for x, y, text in words
                if 39 < x < 59 and header_y + 8 < y < 530 and re.fullmatch(r"\d{2}", text)
            )
            for index, (y, kind) in enumerate(anchors):
                end = anchors[index + 1][0] - 0.1 if index + 1 < len(anchors) else 540
                footer = [wy for x, wy, text in words if x < 60 and text == "Vsi" and wy > y]
                if footer:
                    end = min(end, min(footer))
                band = [word for word in words if y - 0.5 <= word[1] < end]

                def column(start: float, stop: float) -> str:
                    return " ".join(text for x, _, text in band if start <= x < stop)

                def money(start: float, stop: float) -> str:
                    values = [
                        text for x, wy, text in band
                        if start <= x < stop and wy < y + 4 and re.fullmatch(r"-?[\d.]+,\d{2}", text)
                    ]
                    return values[0] if values else ""

                dates = re.findall(r"\d{2}\.\d{2}\.\d{4}", column(265, 310))
                if not dates:
                    dates = re.findall(r"\d{2}\.\d{2}\.\d{4}", column(172, 310))
                if not dates:
                    raise ValueError(f"Missing document date: page {page_number}, y={y}")
                rows.append({
                    "page": page_number,
                    "kind": kind,
                    "entry": column(59, 92),
                    "document": column(92, 172),
                    "description": column(172, 265),
                    "date": dates[0],
                    "debit": str(amount(money(398, 460))),
                    "credit": str(amount(money(460, 523))),
                    "balance": str(amount(money(523, 582))),
                    "remaining": str(amount(money(740, 799))),
                    "closing_references": column(582, 674),
                    "closing_amounts": [
                        str(amount(text)) for x, _, text in band
                        if 674 <= x < 740 and re.fullmatch(r"-?[\d.]+,\d{2}", text)
                    ],
                })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    rows = extract(args.pdf)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    by_year = defaultdict(lambda: {"count": 0, "debit": Decimal(0), "credit": Decimal(0)})
    for row in rows:
        totals = by_year[row["date"][-4:]]
        totals["count"] += 1
        totals["debit"] += Decimal(row["debit"])
        totals["credit"] += Decimal(row["credit"])
    print(args.pdf, "rows:", len(rows))
    for year, totals in sorted(by_year.items()):
        print(year, totals, "net:", totals["debit"] - totals["credit"])
    print("OPEN:", json.dumps([row for row in rows if Decimal(row["remaining"])], ensure_ascii=False))
    print("Extracted rows:", args.output)


if __name__ == "__main__":
    main()