"""Render a source PDF for a read-only comparison with its OCR proposal."""
import sys
import fitz

with fitz.open(sys.argv[1]) as document:
    for page in document:
        print(page.get_text())
    document[0].get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(sys.argv[2])
