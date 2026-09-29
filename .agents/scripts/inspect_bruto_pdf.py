"""Render the supplied trial-balance PDF for visual debugging."""

from pathlib import Path
import fitz

root = Path(__file__).resolve().parents[2]
source = root / "attached_assets/bruto-bilanca-2025-01-01-2025-12-31_1790718228280.pdf"
output = root / ".agents/outputs/bruto-pdf-review"
output.mkdir(parents=True, exist_ok=True)
with fitz.open(source) as doc:
    print(f"{len(doc)} strani")
    for index, page in enumerate(doc):
        text = page.get_text()
        print(f"stran {index+1}: {len(text.splitlines())} vrstic, {page.rect}")
        if index in (0, 1, 2, 3, len(doc)-1):
            page.get_pixmap(matrix=fitz.Matrix(1.7, 1.7), alpha=False).save(output / f"page-{index+1}.png")