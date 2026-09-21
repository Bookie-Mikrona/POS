#!/usr/bin/env python3
"""Generate the POS Gostinstvo production-readiness decision PDF."""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, Spacer, Table, TableStyle
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "POS-Gostinstvo-ocena-produkcijske-pripravljenosti.md"
OUTPUT = ROOT / "docs" / "POS-Gostinstvo-ocena-produkcijske-pripravljenosti.pdf"

spec = importlib.util.spec_from_file_location(
    "pos_audit_pdf", ROOT / "scripts" / "generate_pos_audit_pdf.py"
)
base = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(base)


class ReadinessDoc(base.AuditDoc):
    def __init__(self, filename: str, style_map):
        super().__init__(filename, style_map)
        self.title = "POS Gostinstvo — ocena produkcijske pripravljenosti"

    def draw_page(self, canvas, doc):
        if doc.page == 1:
            return
        canvas.saveState()
        canvas.setFont("Audit", 7.8)
        canvas.setFillColor(base.MUTED)
        canvas.drawString(19 * mm, 10 * mm, "POS Gostinstvo — ocena produkcijske pripravljenosti")
        canvas.drawRightString(A4[0] - 19 * mm, 10 * mm, f"Stran {doc.page}")
        canvas.setStrokeColor(base.LINE)
        canvas.line(19 * mm, 14 * mm, A4[0] - 19 * mm, 14 * mm)
        canvas.restoreState()


def checklist_paragraph(text: str, style):
    return Paragraph("☐ " + base.inline_markup(text), style)


def build_story(style_map):
    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    story = [
        Spacer(1, 33 * mm),
        Paragraph("POS Gostinstvo", style_map["cover"]),
        Paragraph("Ocena produkcijske pripravljenosti", style_map["subtitle"]),
        Spacer(1, 10 * mm),
        Paragraph("Odločitev o produkcijskem delu in prehodu iz starega programa", style_map["meta"]),
        Spacer(1, 75 * mm),
        Paragraph("Različica 1.0 · 6. september 2026", style_map["meta"]),
        PageBreak(),
        Paragraph("Kazalo", style_map["toc_title"]),
    ]
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("RToc1", fontName="Audit-Bold", fontSize=9.8, leading=14,
            textColor=base.BLUE, spaceBefore=2),
        ParagraphStyle("RToc2", fontName="Audit", fontSize=8.7, leading=12.5,
            leftIndent=6 * mm, textColor=base.INK),
    ]
    story += [toc, PageBreak()]

    i = 0
    seen_top = False
    paragraph = []

    def flush():
        nonlocal paragraph
        if paragraph:
            text = " ".join(paragraph)
            if text.startswith("> "):
                pstyle = ParagraphStyle("Decision", parent=style_map["body"],
                    fontName="Audit-Bold", fontSize=11, leading=16, leftIndent=5 * mm,
                    rightIndent=5 * mm, borderColor=base.TEAL, borderWidth=1.2,
                    borderPadding=4 * mm, backColor=base.PALE_TEAL, textColor=base.BLUE)
                story.append(Paragraph(base.inline_markup(text[2:]), pstyle))
            else:
                story.append(Paragraph(base.inline_markup(text), style_map["body"]))
            paragraph = []

    while i < len(lines):
        line = lines[i].rstrip()
        if not line:
            flush()
            i += 1
            continue
        if line.startswith("|"):
            flush()
            table_lines = []
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                table_lines.append(lines[i])
                i += 1
            rows = []
            for raw in table_lines:
                cells = [c.strip() for c in raw.strip().strip("|").split("|")]
                if all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
                    continue
                rows.append(cells)
            data = []
            for ri, row in enumerate(rows):
                s = style_map["table_head"] if ri == 0 else style_map["table_body"]
                data.append([Paragraph(base.inline_markup(c), s) for c in row])
            table = Table(data, colWidths=[48 * mm, 30 * mm, 84 * mm], repeatRows=1)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), base.BLUE),
                ("GRID", (0, 0), (-1, -1), 0.45, base.LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, base.PALE_BLUE]),
            ]))
            story += [table, Spacer(1, 3 * mm)]
            continue
        hm = re.match(r"^(#{1,3})\s+(.+)$", line)
        if hm:
            flush()
            level = len(hm.group(1))
            title = hm.group(2)
            if level == 1 and title == "POS Gostinstvo — ocena produkcijske pripravljenosti":
                i += 1
                continue
            if level == 1:
                seen_top = True
            outline = level - 1 if seen_top else max(0, level - 2)
            story.append(base.heading(title, level, style_map, outline))
        elif re.match(r"^- \[ \] ", line):
            flush()
            story.append(checklist_paragraph(line[6:], style_map["bullet"]))
        elif line.startswith("- "):
            flush()
            story.append(Paragraph("• " + base.inline_markup(line[2:]), style_map["bullet"]))
        elif re.match(r"^\d+\.\s+", line):
            flush()
            num, text = line.split(".", 1)
            story.append(Paragraph(f"{num}. " + base.inline_markup(text.strip()), style_map["number"]))
        else:
            paragraph.append(line.strip())
        i += 1
    flush()
    return story


def main():
    base.register_fonts()
    style_map = base.styles()
    doc = ReadinessDoc(str(OUTPUT), style_map)
    doc.multiBuild(build_story(style_map))
    print(OUTPUT)


if __name__ == "__main__":
    main()