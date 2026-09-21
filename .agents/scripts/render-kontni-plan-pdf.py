from pathlib import Path
import fitz

input_path = Path("attached_assets/konto_1785161716983.pdf")
output_dir = Path(".agents/outputs/kontni-plan-pdf")
output_dir.mkdir(parents=True, exist_ok=True)

document = fitz.open(input_path)
for index in range(min(3, document.page_count)):
    page = document[index]
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    pixmap.save(output_dir / f"page-{index + 1}.png")

print(f"Rendered {min(3, document.page_count)} of {document.page_count} pages to {output_dir}")