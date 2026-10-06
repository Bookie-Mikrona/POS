"""Read-only inventory and visual index of supplied legacy reference materials."""
import hashlib
import json
from collections import Counter
from pathlib import Path

import fitz

root = Path("attached_assets")
out = Path("/tmp/bookie-functional-audit")
out.mkdir(exist_ok=True)
files = sorted(path for path in root.iterdir() if path.is_file())
inventory = []
images = []
for index, path in enumerate(files, 1):
    entry = {"index": index, "file": str(path), "bytes": path.stat().st_size,
             "extension": path.suffix.lower(), "review": "not_reviewed"}
    # Hash streaming; do not load large database/ZIP uploads into memory.
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    entry["sha256"] = digest.hexdigest()
    if path.suffix.lower() == ".pdf":
        try:
            pdf = fitz.open(path)
            entry["pages"] = len(pdf)
            text = pdf[0].get_text()
            entry["first_page_text"] = text[:1800]
            pdf[0].get_pixmap(matrix=fitz.Matrix(1, 1)).save(out / f"pdf-{index:03}.png")
            entry["review"] = "first_page_extracted_and_rendered"
        except Exception as error:
            entry["error"] = str(error)
    elif path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
        images.append((index, path))
        entry["review"] = "contact_sheet_only"
    inventory.append(entry)

for sheet_index, offset in enumerate(range(0, len(images), 40), 1):
    subset = images[offset:offset + 40]
    sheet = fitz.open()
    page = sheet.new_page(width=1400, height=1600)
    for pos, (index, path) in enumerate(subset):
        x, y = (pos % 5) * 280, (pos // 5) * 200
        page.insert_image(fitz.Rect(x + 3, y + 3, x + 277, y + 173), filename=str(path))
        page.insert_text((x + 3, y + 190), f"{index:03} {path.stem[-23:]}", fontsize=12)
    page.get_pixmap().save(out / f"images-{sheet_index}.png")

(out / "inventory.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2))
print("Uploads:", len(files))
print("By extension:", dict(Counter(entry["extension"] for entry in inventory)))
print("Contact sheets:", (len(images) + 39) // 40)
for entry in inventory:
    if entry["extension"] == ".pdf":
        print(entry["index"], Path(entry["file"]).name, entry.get("pages"),
              entry.get("first_page_text", "").replace("\n", " ")[:210])
