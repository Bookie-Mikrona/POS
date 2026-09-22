from pathlib import Path

import pymupdf


source = Path("attached_assets/DocScan_1790094014730.pdf")
output_dir = Path(".agents/outputs/docscan-menu")
output_dir.mkdir(parents=True, exist_ok=True)

document = pymupdf.open(source)
print(f"pages={document.page_count}")

for index, page in enumerate(document):
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
    output = output_dir / f"page-{index + 1:02d}.png"
    pixmap.save(output)
    print(output)

page = document[9]
pixmap = page.get_pixmap(matrix=pymupdf.Matrix(6, 6), alpha=False)
output = output_dir / "page-10-hires.png"
pixmap.save(output)
print(output)