from pathlib import Path
import sys

import fitz


pdf_path = Path(sys.argv[1])
output_dir = Path(".agents/outputs/new-company-chart")
output_dir.mkdir(parents=True, exist_ok=True)

document = fitz.open(pdf_path)
print(f"file={pdf_path} pages={document.page_count} metadata={document.metadata}")
for page_number, page in enumerate(document, start=1):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    image_path = output_dir / f"page-{page_number}.png"
    pixmap.save(image_path)
    text = page.get_text("text")
    print(f"page={page_number} image={image_path} chars={len(text)}")