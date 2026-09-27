from pathlib import Path

import fitz

root = Path(__file__).resolve().parents[2]
pdf = fitz.open(root / "docs/POS-Gostinstvo-prirocnik-v8.7.pdf")
output = root / ".agents/outputs/pos-manual-v87"
output.mkdir(parents=True, exist_ok=True)

targets = {0, 1, 2, len(pdf) - 1}
needles = (
    "Spletna prodaja individualnega bona",
    "Proizvodni nalog",
    "Kratka zgodovina dokumentacije",
    "Izvoz: PDF cenik z alergeni",
)
found = {}
for index, page in enumerate(pdf):
    text = page.get_text()
    for needle in needles:
        if index >= 50 and needle in text and needle not in found:
            found[needle] = index + 1
            targets.add(index)

for index in sorted(targets):
    page = pdf[index]
    page.get_pixmap(matrix=fitz.Matrix(1.35, 1.35), alpha=False).save(
        output / f"page-{index + 1:03d}.png"
    )

print(f"pages={len(pdf)}")
print(f"rendered={[index + 1 for index in sorted(targets)]}")
print(f"found={found}")