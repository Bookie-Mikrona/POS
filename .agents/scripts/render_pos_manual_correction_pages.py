from pathlib import Path

import fitz


PDF_PATH = Path("docs/POS-Gostinstvo-prirocnik-v6.1.pdf")
OUTPUT_DIR = Path(".agents/outputs/pos-manual-correction")
SEARCH_TERMS = [
    "Korekcija dejanske količine v posodi",
    "Strošek kala = količina kala",
    "pripravljenih je 10 porcij golaža",
]


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    document = fitz.open(PDF_PATH)
    matched_pages: set[int] = set()

    for page_number, page in enumerate(document):
        text = page.get_text()
        if any(term.casefold() in text.casefold() for term in SEARCH_TERMS):
            matched_pages.add(page_number)

    if not matched_pages:
        raise SystemExit("V PDF-ju ni bilo mogoče najti novih razlag korekcije in stroška kala.")

    for page_number in sorted(matched_pages):
        page = document[page_number]
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        output_path = OUTPUT_DIR / f"page-{page_number + 1}.png"
        pixmap.save(output_path)
        print(output_path)

    print(f"pages={document.page_count}")
    print(f"matched={','.join(str(page + 1) for page in sorted(matched_pages))}")


if __name__ == "__main__":
    main()