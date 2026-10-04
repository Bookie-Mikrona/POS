"""Inspect public dessert leaflets and menu pages for research."""
from pathlib import Path
from urllib.request import urlopen

import fitz

OUT = Path("/tmp/dessert-research")
OUT.mkdir(exist_ok=True)
SOURCES = {
    "gibanica": "https://www.disi-po-prekmurju.si/storage/app/media/gibzgib19ANG.pdf",
    "rajh": "https://www.rajh.si/upload/files/gostilna_rajh_menu_si.pdf?v202606",
    "park": "https://www.sava-hotels-resorts.com/media/gcdfcotr/cenik-kavarna-park.pdf",
}
for name, url in SOURCES.items():
    with urlopen(url, timeout=30) as response:
        data = response.read()
    doc = fitz.open(stream=data, filetype="pdf")
    print(f"\n{name}: {len(doc)} pages")
    for index, page in enumerate(doc):
        text = page.get_text()
        selected = (
            name == "gibanica"
            or (name == "rajh" and any(term in text.lower() for term in ("hodni", "hodov", "gibanica")))
            or (name == "park" and "kremna rezina" in text.lower())
        )
        if selected:
            dest = OUT / f"{name}-{index + 1}.png"
            page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(dest)
            print(f"Image: {dest}\n{text[:9000]}")