from pathlib import Path
import fitz

source = Path("attached_assets/Kontni_načrt_CELOTNI_1787345580580.pdf")
output = Path(".agents/outputs/private-chart-pdf")
output.mkdir(parents=True, exist_ok=True)

document = fitz.open(source)
print(f"pages={document.page_count}")
print(f"metadata={document.metadata}")

for index, page in enumerate(document):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
    target = output / f"page-{index + 1:03d}.png"
    pixmap.save(target)
    print(target)