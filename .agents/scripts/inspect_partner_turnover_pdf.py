"""Render the first and final pages of a supplied PDF for visual inspection."""

import argparse
from pathlib import Path

import fitz


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, default=Path("/tmp/partner-turnover-pdf"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with fitz.open(args.pdf) as document:
        print(f"Pages: {document.page_count}")
        for index in sorted({0, document.page_count - 1}):
            page = document[index]
            image = args.output / f"page-{index + 1}.png"
            page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6)).save(image)
            print(f"Image: {image}")


if __name__ == "__main__":
    main()