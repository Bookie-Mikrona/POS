"""Render prepared AJPES fixture PDFs for visual inspection without business data."""
from pathlib import Path
import fitz

for label in ("ordinary", "micro"):
    source = Path(f"/tmp/ajpes-phaseb-{label}.pdf")
    with fitz.open(source) as pdf:
        print(label, "pages:", pdf.page_count)
        for page in pdf:
            text = page.get_text()
            if not text.strip():
                raise RuntimeError(f"Blank page in {source}: {page.number + 1}")
        # Inspect cover/numerical layout, the end of BS/micro disclosures, and texts.
        for index in sorted({0, min(1, len(pdf) - 1), len(pdf) - 1}):
            out = Path(f"/tmp/ajpes-phaseb-{label}-{index + 1}.png")
            pdf[index].get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(out)
            print("rendered", out)