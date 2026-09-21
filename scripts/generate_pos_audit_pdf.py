#!/usr/bin/env python3
"""Generate the standalone POS Gostinstvo module audit PDF."""

from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "POS-Gostinstvo-celoten-pregled.md"
OUTPUT = ROOT / "docs" / "POS-Gostinstvo-celoten-pregled.pdf"

BLUE = colors.HexColor("#163A5F")
TEAL = colors.HexColor("#087F8C")
PALE_BLUE = colors.HexColor("#EAF2F8")
PALE_TEAL = colors.HexColor("#E7F4F3")
PALE_YELLOW = colors.HexColor("#FFF6D8")
INK = colors.HexColor("#1C2733")
MUTED = colors.HexColor("#566573")
LINE = colors.HexColor("#CCD6DD")


def register_fonts() -> None:
    regular = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    pdfmetrics.registerFont(TTFont("Audit", regular))
    pdfmetrics.registerFont(TTFont("Audit-Bold", bold))
    pdfmetrics.registerFontFamily("Audit", normal="Audit", bold="Audit-Bold")


def inline_markup(text: str) -> str:
    escaped = html.escape(text, quote=False)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"`(.+?)`", r"<font name='Audit-Bold'>\1</font>", escaped)
    return escaped


def styles():
    sample = getSampleStyleSheet()
    return {
        "cover": ParagraphStyle("Cover", parent=sample["Title"], fontName="Audit-Bold",
            fontSize=29, leading=35, alignment=TA_CENTER, textColor=BLUE, spaceAfter=10 * mm),
        "subtitle": ParagraphStyle("Subtitle", fontName="Audit", fontSize=14, leading=21,
            alignment=TA_CENTER, textColor=TEAL),
        "meta": ParagraphStyle("Meta", fontName="Audit", fontSize=10, leading=15,
            alignment=TA_CENTER, textColor=MUTED),
        "h1": ParagraphStyle("H1", fontName="Audit-Bold", fontSize=18, leading=23,
            textColor=BLUE, spaceBefore=7 * mm, spaceAfter=4 * mm, keepWithNext=True),
        "h2": ParagraphStyle("H2", fontName="Audit-Bold", fontSize=13.5, leading=18,
            textColor=TEAL, spaceBefore=5 * mm, spaceAfter=2.5 * mm, keepWithNext=True),
        "h3": ParagraphStyle("H3", fontName="Audit-Bold", fontSize=11.3, leading=15,
            textColor=BLUE, spaceBefore=4 * mm, spaceAfter=2 * mm, keepWithNext=True),
        "body": ParagraphStyle("Body", fontName="Audit", fontSize=9.7, leading=14.2,
            alignment=TA_JUSTIFY, textColor=INK, spaceAfter=2.4 * mm),
        "bullet": ParagraphStyle("Bullet", fontName="Audit", fontSize=9.5, leading=13.8,
            leftIndent=7 * mm, firstLineIndent=-4 * mm, textColor=INK, spaceAfter=1.3 * mm),
        "number": ParagraphStyle("Number", fontName="Audit", fontSize=9.5, leading=13.8,
            leftIndent=9 * mm, firstLineIndent=-6 * mm, textColor=INK, spaceAfter=1.3 * mm),
        "table_head": ParagraphStyle("TableHead", fontName="Audit-Bold", fontSize=7.7,
            leading=10, textColor=colors.white, alignment=TA_LEFT),
        "table_body": ParagraphStyle("TableBody", fontName="Audit", fontSize=7.4,
            leading=10.2, textColor=INK),
        "toc_title": ParagraphStyle("TocTitle", fontName="Audit-Bold", fontSize=20,
            leading=25, textColor=BLUE, alignment=TA_CENTER, spaceAfter=6 * mm),
    }


class AuditDoc(BaseDocTemplate):
    def __init__(self, filename: str, style_map):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=19 * mm,
            rightMargin=19 * mm,
            topMargin=20 * mm,
            bottomMargin=18 * mm,
            title="POS Gostinstvo — celovit pregled modula",
            author="Mikrona / Bookie",
            subject="Pregled implementacije, omejitev in razvojnih prioritet",
        )
        self.style_map = style_map
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="body")
        self.addPageTemplates(PageTemplate(id="audit", frames=[frame], onPage=self.draw_page))

    def draw_page(self, canvas, doc):
        if doc.page == 1:
            return
        canvas.saveState()
        canvas.setFont("Audit", 7.8)
        canvas.setFillColor(MUTED)
        canvas.drawString(19 * mm, 10 * mm, "POS Gostinstvo — celovit pregled modula")
        canvas.drawRightString(A4[0] - 19 * mm, 10 * mm, f"Stran {doc.page}")
        canvas.setStrokeColor(LINE)
        canvas.line(19 * mm, 14 * mm, A4[0] - 19 * mm, 14 * mm)
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph):
            level = getattr(flowable, "_audit_level", None)
            title = getattr(flowable, "_audit_title", None)
            if level is not None and title:
                key = f"h-{self.seq.nextf('heading')}"
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(title, key, level=level, closed=False)
                self.notify("TOCEntry", (level, title, self.page, key))


def heading(text: str, level: int, style_map, outline_level: int | None = None):
    p = Paragraph(inline_markup(text), style_map[f"h{min(level, 3)}"])
    p._audit_level = level - 1 if outline_level is None else outline_level
    p._audit_title = text
    return p


def parse_table(lines, style_map):
    rows = []
    for line in lines:
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        rows.append(cells)
    data = []
    for row_index, row in enumerate(rows):
        style = style_map["table_head"] if row_index == 0 else style_map["table_body"]
        data.append([Paragraph(inline_markup(cell), style) for cell in row])
    table = Table(data, colWidths=[38 * mm, 28 * mm, 96 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE_BLUE]),
    ]))
    return table


def build_story(style_map):
    source_lines = SOURCE.read_text(encoding="utf-8").splitlines()
    story = [
        Spacer(1, 33 * mm),
        Paragraph("POS Gostinstvo", style_map["cover"]),
        Paragraph("Celovit pregled modula", style_map["subtitle"]),
        Spacer(1, 10 * mm),
        Paragraph("Implementirano · delno izvedeno · manjkajoče · razvojne prioritete", style_map["meta"]),
        Spacer(1, 7 * mm),
        Paragraph("Pregled trenutnega POS odjemalca, pripadajočih API-poti, naprav, integracij, testov in povezave POS→ERP", style_map["meta"]),
        Spacer(1, 80 * mm),
        Paragraph("Različica 1.0 · 6. september 2026", style_map["meta"]),
        PageBreak(),
        Paragraph("Kazalo", style_map["toc_title"]),
    ]
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("Toc1", fontName="Audit-Bold", fontSize=9.8, leading=14,
            leftIndent=0, firstLineIndent=0, textColor=BLUE, spaceBefore=2),
        ParagraphStyle("Toc2", fontName="Audit", fontSize=8.7, leading=12.5,
            leftIndent=6 * mm, firstLineIndent=0, textColor=INK),
    ]
    story += [toc, PageBreak()]

    index = 0
    paragraph_buffer = []
    seen_top_level = False

    def flush_paragraph():
        nonlocal paragraph_buffer
        if paragraph_buffer:
            story.append(Paragraph(inline_markup(" ".join(paragraph_buffer)), style_map["body"]))
            paragraph_buffer = []

    while index < len(source_lines):
        line = source_lines[index].rstrip()
        if not line:
            flush_paragraph()
            index += 1
            continue
        if line.startswith("|"):
            flush_paragraph()
            table_lines = []
            while index < len(source_lines) and source_lines[index].lstrip().startswith("|"):
                table_lines.append(source_lines[index])
                index += 1
            story.append(parse_table(table_lines, style_map))
            story.append(Spacer(1, 3 * mm))
            continue
        match = re.match(r"^(#{1,3})\s+(.+)$", line)
        if match:
            flush_paragraph()
            level = len(match.group(1))
            title = match.group(2).strip()
            if level == 1 and title == "POS Gostinstvo — celovit pregled modula":
                index += 1
                continue
            if level == 1:
                seen_top_level = True
            outline_level = level - 1
            if not seen_top_level and level > 1:
                outline_level = level - 2
            story.append(heading(title, level, style_map, outline_level))
            index += 1
            continue
        bullet = re.match(r"^-\s+(.+)$", line)
        numbered = re.match(r"^(\d+)\.\s+(.+)$", line)
        if bullet:
            flush_paragraph()
            story.append(Paragraph("• " + inline_markup(bullet.group(1)), style_map["bullet"]))
        elif numbered:
            flush_paragraph()
            story.append(Paragraph(f"{numbered.group(1)}. " + inline_markup(numbered.group(2)), style_map["number"]))
        else:
            paragraph_buffer.append(line.strip())
        index += 1
    flush_paragraph()
    return story


def main() -> None:
    register_fonts()
    style_map = styles()
    doc = AuditDoc(str(OUTPUT), style_map)
    doc.multiBuild(build_story(style_map))
    print(OUTPUT)


if __name__ == "__main__":
    main()