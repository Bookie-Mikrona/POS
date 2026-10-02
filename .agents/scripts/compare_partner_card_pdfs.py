from pathlib import Path
import fitz

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".agents/outputs/partner-card-comparison"
OUT.mkdir(parents=True, exist_ok=True)
for label, filename in [
    ("old", "kpz_1790927092946.PDF"),
    ("new", "kartica-partnerja-2026-10-02_1790927092947.pdf"),
]:
    doc = fitz.open(ROOT / "attached_assets" / filename)
    print(label, "pages", len(doc))
    text = []
    for i, page in enumerate(doc):
        text.append(f"\n=== PAGE {i+1} ===\n" + page.get_text(sort=True))
        if i in {0, len(doc)-1}:
            page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(OUT / f"{label}-{i+1}.png")
    (OUT / f"{label}.txt").write_text("".join(text), encoding="utf8")
    print("".join(text)[:6500])