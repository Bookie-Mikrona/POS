from pathlib import Path

import fitz


pdf_path = Path("attached_assets/RS_-2024-081-02384-OB~P001-0000_1787342221946.pdf")
render_dir = Path(".agents/outputs/kontni-plan-srs-2024")
render_dir.mkdir(parents=True, exist_ok=True)

document = fitz.open(pdf_path)
print(f"pages={document.page_count}")

for page_number, page in enumerate(document, start=1):
    if page_number <= 3:
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        pixmap.save(render_dir / f"page-{page_number:02d}.png")

    text = page.get_text("text")
    print(f"\n--- PAGE {page_number} ---\n{text.rstrip()}")