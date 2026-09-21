#!/usr/bin/env python3
from pathlib import Path

import fitz


root = Path(__file__).resolve().parents[2]
pdf_path = root / "docs" / "POS-Gostinstvo-prirocnik-v8.0.pdf"
output_dir = root / ".agents" / "outputs" / "pos-manual-v8-samples"
output_dir.mkdir(parents=True, exist_ok=True)

document = fitz.open(pdf_path)
requested = [0, 4, 20, 100, 200, 300, document.page_count - 1]
for page_number in requested:
    page = document[page_number]
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
    pixmap.save(output_dir / f"page-{page_number + 1:03d}.png")

print(f"Rendered {len(requested)} pages from {document.page_count} total pages")