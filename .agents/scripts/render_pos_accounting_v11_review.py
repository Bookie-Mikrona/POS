#!/usr/bin/env python3
"""Render the changed accounting edge-case pages for visual review."""

from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "docs" / "POS-Gostinstvo-racunovodski-prirocnik-v1.2.pdf"
OUTPUT_DIR = ROOT / ".agents" / "outputs" / "pos-accounting-v12-review"


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    document = fitz.open(PDF)
    matching_pages = [
        page_number
        for page_number, page in enumerate(document)
        if page_number >= 10
        and (
            "Mejni primeri: kava" in page.get_text()
            or "»To Go« kava z lončkom" in page.get_text()
            or "»To Go« piškot z vrečko" in page.get_text()
            or "Mešano naročilo: pri mizi" in page.get_text()
            or "Razbita, uničena ali drugače nevračljiva embalaža" in page.get_text()
        )
    ]
    if not matching_pages:
        raise RuntimeError("New accounting examples were not found in the PDF")
    pages_to_render = sorted({
        nearby_page
        for page_number in matching_pages
        for nearby_page in (page_number - 1, page_number, page_number + 1)
        if 0 <= nearby_page < len(document)
    })
    for page_number in pages_to_render:
        page = document[page_number]
        pixmap = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
        output = OUTPUT_DIR / f"page-{page_number + 1:03d}.png"
        pixmap.save(output)
        print(output)


if __name__ == "__main__":
    main()