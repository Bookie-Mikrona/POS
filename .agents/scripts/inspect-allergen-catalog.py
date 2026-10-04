"""Read an uploaded allergen catalog and render a sample page for inspection."""
import json
from pathlib import Path
import re
import subprocess
import sys

source = Path(sys.argv[1])
output = Path("/tmp/krizisce-allergen-review")
output.mkdir(exist_ok=True)
try:
    import fitz
except ImportError:
    subprocess.run(["pdftoppm", "-f", "2", "-l", "2", "-singlefile", "-scale-to",
                    "1500", "-png", str(source), str(output / "page-2")], check=True)
else:
    with fitz.open(source) as document:
        document[1].get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(output / "page-2.png")

subprocess.run(["pdftotext", "-layout", str(source), str(output / "catalog.txt")], check=True)
text = (output / "catalog.txt").read_text()
ids = [int(match.group(1)) for match in re.finditer(r"^\s*(\d{5})\s+", text, re.MULTILINE)]
(output / "ids.json").write_text(json.dumps(ids))
print(f"Rows: {len(ids)}; distinct IDs: {len(set(ids))}")
print(f"Rendered page: {output / 'page-2.png'}")