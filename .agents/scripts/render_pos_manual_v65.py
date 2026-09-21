from pathlib import Path

import fitz


root = Path(__file__).resolve().parents[2]
pdf_path = root / "docs" / "POS-Gostinstvo-prirocnik-v6.5.pdf"
output_dir = root / ".agents" / "outputs" / "pos-manual-v65"
output_dir.mkdir(parents=True, exist_ok=True)

doc = fitz.open(pdf_path)
targets = {0, 1, doc.page_count - 1}

for index, page in enumerate(doc):
    text = page.get_text()
    if "Dodatek: funkcionalne in varnostne dopolnitve" in text:
        targets.add(index)
    if "Zaključna kontrola po spremembi" in text:
        targets.add(index)

for index in sorted(targets):
    page = doc[index]
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
    pixmap.save(output_dir / f"page-{index + 1:03d}.png")

print(f"pages={doc.page_count}")
print("rendered=" + ",".join(str(index + 1) for index in sorted(targets)))
print(f"output={output_dir}")