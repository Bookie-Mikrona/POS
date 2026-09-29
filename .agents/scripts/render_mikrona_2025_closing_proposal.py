"""Render the review copy for visual inspection without altering the PDF."""

from pathlib import Path

import fitz


root = Path(__file__).resolve().parents[2]
source = root / "reports/mikrona-2025-predlog-zakljucne-temeljnice.pdf"
output = root / ".agents/outputs"
output.mkdir(parents=True, exist_ok=True)

with fitz.open(source) as document:
    for number, page in enumerate(document, 1):
        destination = output / f"mikrona-2025-predlog-stran-{number}.png"
        page.get_pixmap(matrix=fitz.Matrix(1.7, 1.7), alpha=False).save(destination)
        print(destination.relative_to(root))