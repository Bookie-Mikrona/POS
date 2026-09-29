"""Render submitted 2025 accounting statements for visual reconciliation."""

from pathlib import Path

import pymupdf


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / ".agents" / "outputs" / "mikrona-2025-source"
OUTPUT.mkdir(parents=True, exist_ok=True)

for name in ("Bilanca(4)_1790715996751.PDF", "zaklj_rac_1790716113543.PDF"):
    document = pymupdf.open(ROOT / "attached_assets" / name)
    for index, page in enumerate(document):
        image = page.get_pixmap(matrix=pymupdf.Matrix(1.4, 1.4), alpha=False)
        image.save(OUTPUT / f"{name.removesuffix('.PDF')}-page-{index + 1}.png")
    print(f"{name}: {len(document)} strani upodobljenih v {OUTPUT}")