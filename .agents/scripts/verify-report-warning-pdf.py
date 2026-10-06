"""Render first/last pages and check real page numbering in diagnostic PDFs."""
import sys
from pathlib import Path
import fitz

for filename in sys.argv[1:]:
    doc = fitz.open(filename)
    for index, page in enumerate(doc):
        expected = f"Stran {index + 1} / {len(doc)}"
        if expected not in page.get_text():
            raise RuntimeError(f"{filename}: missing footer {expected}")
        footer = [word for word in page.get_text("words")
                  if word[4] == "Stran" and word[1] > page.rect.height - 80]
        if not footer or footer[0][0] < page.rect.width * 0.6:
            raise RuntimeError(f"{filename}: page number overlaps left footer")
    stem = Path(filename).stem
    for index in sorted({0, len(doc) - 1}):
        doc[index].get_pixmap(matrix=fitz.Matrix(1.4, 1.4)).save(
            f"/tmp/{stem}-page-{index + 1}.png"
        )
    print(f"{filename}: {len(doc)} pages, numbering verified, first/last rendered")
