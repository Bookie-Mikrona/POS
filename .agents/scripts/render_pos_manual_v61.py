from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "docs" / "POS-Gostinstvo-prirocnik-v6.1.pdf"
OUTPUT_DIR = ROOT / ".agents" / "outputs" / "pos-manual-v61"
PAGES = (1, 5, 377, 378, 390, 402, 403)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    document = fitz.open(PDF)
    for page_number in PAGES:
        page = document[page_number - 1]
        pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        pixmap.save(OUTPUT_DIR / f"page-{page_number:03d}.png")
    print(f"Rendered {len(PAGES)} pages from {document.page_count}-page PDF to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()