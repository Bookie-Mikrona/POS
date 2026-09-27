#!/usr/bin/env python3
"""Generate the long-form POS Gostinstvo user manual from reviewed Markdown."""

from __future__ import annotations

import html
import re
from datetime import date
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
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Image as RLImage,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "docs" / "pos-manual-src"
POS_PLAN_SCHEMA = ROOT / "lib" / "db" / "src" / "schema" / "company-pos-plans.ts"
MANUAL_VERSION = "8.7"
MANUAL_RELEASE_DATE = date(2026, 9, 27)
OUTPUT = ROOT / "docs" / f"POS-Gostinstvo-prirocnik-v{MANUAL_VERSION}.pdf"
PUBLIC_OUTPUT = ROOT / "artifacts" / "pos" / "public" / "POS-Gostinstvo-prirocnik.pdf"
LOGO = ROOT / "docs" / "mikrona-logo.png"

SOURCE_FILES = [
    ("I", "Dostop in priprava sistema", "01-operativno-delo.md"),
    ("II", "Začetek izmene in delovno okolje", "02-placila-racuni-furs-tisk.md"),
    ("III", "Mize, rezervacije in naročila", "03-meni-artikli-normativi.md"),
    ("IV", "Meni, artikli, normativi in alergeni", "04-zaloge-dokumenti.md"),
    ("V", "Priprava, KDS, QR meni in telefonska naročila", "05-pripravljena-hrana-qr-telefon.md"),
    ("VI", "Plačilo, račun, FURS in tisk", "06-izmene-porocila-nastavitve.md"),
    ("VII", "Zaloge, prejemnice, OCR, pripravljena hrana, odpad in dogodki", "07-zacetek-dela-dostop.md"),
    ("VIII", "Konec izmene, blagajniški premiki, poročila in POS→ERP", "08-nastavitve-po-sklopih.md"),
    ("IX", "Nastavitve, naprave, uporabniki in varnost", "09-postopki-po-vlogah.md"),
    ("X", "Hitri postopki po vlogah", "10-odlocitvena-drevesa-kontrolni-seznami.md"),
    ("XI", "Odpravljanje težav in izredni primeri", "11-vnos-uvoz-prejemnice-ocr.md"),
    ("XII", "Slovar, kontrolni seznami in kratka zgodovina različice", "12-spremembe-in-dopolnitve.md"),
]
NON_SLOVENIAN_DATE = re.compile(
    r"\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,3}\b"
    r"|\b\d{1,2}/\d{1,2}/(?:19|20)\d{2}\b"
)

BLUE = colors.HexColor("#163A5F")
TEAL = colors.HexColor("#087F8C")
PALE_BLUE = colors.HexColor("#EAF2F8")
PALE_TEAL = colors.HexColor("#E7F4F3")
PALE_YELLOW = colors.HexColor("#FFF6D8")
INK = colors.HexColor("#1C2733")
MUTED = colors.HexColor("#566573")
LINE = colors.HexColor("#CCD6DD")

PACKAGE_LABELS = {
    "lite": "Lite",
    "standard": "Standard",
    "extended": "Extended",
}
HEADING_METADATA = re.compile(
    r"^\s*<!--\s*pos-heading:\s*id=([A-Za-z0-9][A-Za-z0-9._:-]*)\s+"
    r"package=([a-z][a-z0-9_-]*)\s*-->\s*$"
)
HEADING_REF = re.compile(
    r"\s*<!--\s*pos-heading-ref:\s*id=([A-Za-z0-9][A-Za-z0-9._:-]*)\s+"
    r"package=([a-z][a-z0-9_-]*)\s*-->\s*$"
)


def load_pos_plan_catalog() -> tuple[str, ...]:
    source = POS_PLAN_SCHEMA.read_text(encoding="utf-8")
    match = re.search(
        r"export\s+const\s+POS_PLANS\s*=\s*\[([^\]]+)\]\s*as\s+const",
        source,
    )
    if not match:
        raise ValueError(f"V {POS_PLAN_SCHEMA} ni mogoče prebrati POS_PLANS.")
    plans = tuple(re.findall(r'["\']([a-z][a-z0-9_-]*)["\']', match.group(1)))
    if not plans or len(plans) != len(set(plans)):
        raise ValueError(f"POS_PLANS v {POS_PLAN_SCHEMA} je prazen ali podvojen.")
    if set(plans) != set(PACKAGE_LABELS):
        raise ValueError(
            "Oznake priročnika niso usklajene z osrednjim katalogom POS paketov: "
            f"priročnik={sorted(PACKAGE_LABELS)}, katalog={sorted(plans)}"
        )
    return plans


POS_PLAN_CATALOG = load_pos_plan_catalog()


def extract_heading_metadata(
    text: str,
    source_name: str,
    seen_ids: set[str] | None = None,
    *,
    preserve_refs: bool = False,
) -> tuple[str, list[tuple[str, str]]]:
    """Remove and validate per-heading technical metadata.

    Metadata is deliberately attached to the heading on the following line;
    consequently moving a heading block moves its package assignment too.
    """
    lines = text.splitlines()
    metadata: dict[str, str] = {}
    metadata_in_order: list[tuple[str, str]] = []
    seen_ids = seen_ids if seen_ids is not None else set()
    cleaned: list[str] = []
    pending: tuple[str, str] | None = None
    for line_number, line in enumerate(lines, start=1):
        match = HEADING_METADATA.match(line)
        heading = re.match(r"^\s*#{1,4}\s+.+$", line)
        if match:
            if pending is not None:
                raise ValueError(
                    f"{source_name}:{line_number}: osiroteli metapodatki "
                    f"za naslovom '{pending[0]}'."
                )
            pending = (match.group(1), match.group(2))
            continue
        if heading:
            if pending is None:
                raise ValueError(
                    f"{source_name}:{line_number}: naslov nima metapodatkov "
                    "(id in package)."
                )
            identifier, package = pending
            if identifier in metadata:
                raise ValueError(
                    f"{source_name}:{line_number}: podvojen ID '{identifier}'."
                )
            if identifier in seen_ids:
                raise ValueError(
                    f"{source_name}:{line_number}: podvojen ID '{identifier}' "
                    "v drugem viru."
                )
            if package not in POS_PLAN_CATALOG:
                raise ValueError(
                    f"{source_name}:{line_number}: paket '{package}' ni v "
                    f"osrednjem katalogu ({', '.join(POS_PLAN_CATALOG)})."
                )
            metadata[identifier] = package
            metadata_in_order.append((identifier, package))
            seen_ids.add(identifier)
            pending = None
            if preserve_refs:
                cleaned.append(
                    f"{line} <!-- pos-heading-ref: id={identifier} "
                    f"package={package} -->"
                )
            else:
                cleaned.append(line)
            continue
        if pending is not None:
            raise ValueError(
                f"{source_name}:{line_number}: metapodatki niso neposredno "
                "pred naslovom."
            )
        cleaned.append(line)
    if pending is not None:
        raise ValueError(f"{source_name}: osiroteli metapodatki na koncu datoteke.")
    if not metadata:
        raise ValueError(f"{source_name}: manjkajo metapodatki naslovov.")
    return "\n".join(cleaned), metadata_in_order


def package_badge(package: str) -> str:
    label = PACKAGE_LABELS[package]
    colors_by_package = {
        "lite": ("#EAF2F8", "#163A5F"),
        "standard": ("#E7F4F3", "#087F8C"),
        "extended": ("#FFF0D8", "#8A4B08"),
    }
    background, foreground = colors_by_package[package]
    return (
        f'<font size="7.5" color="{foreground}" backColor="{background}">'
        f"&nbsp;<b>POS {label}</b>&nbsp;</font>"
    )


def register_fonts() -> None:
    regular = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    # The Replit font bundle contains the regular and bold DejaVu faces.
    # Register the regular face for italic markup as well so Slovenian glyphs
    # remain available and PDF generation is portable across the workspace.
    italic = regular
    pdfmetrics.registerFont(TTFont("Manual", regular))
    pdfmetrics.registerFont(TTFont("Manual-Bold", bold))
    pdfmetrics.registerFont(TTFont("Manual-Italic", italic))
    pdfmetrics.registerFontFamily(
        "Manual",
        normal="Manual",
        bold="Manual-Bold",
        italic="Manual-Italic",
        boldItalic="Manual-Bold",
    )


def make_styles():
    sample = getSampleStyleSheet()
    styles = {
        "cover_title": ParagraphStyle(
            "CoverTitle",
            parent=sample["Title"],
            fontName="Manual-Bold",
            fontSize=29,
            leading=35,
            alignment=TA_CENTER,
            textColor=BLUE,
            spaceAfter=10 * mm,
        ),
        "cover_subtitle": ParagraphStyle(
            "CoverSubtitle",
            fontName="Manual",
            fontSize=15,
            leading=22,
            alignment=TA_CENTER,
            textColor=TEAL,
        ),
        "cover_meta": ParagraphStyle(
            "CoverMeta",
            fontName="Manual",
            fontSize=10.5,
            leading=16,
            alignment=TA_CENTER,
            textColor=MUTED,
        ),
        "cover_package_title": ParagraphStyle(
            "CoverPackageTitle",
            fontName="Manual-Bold",
            fontSize=10.2,
            leading=13,
            textColor=BLUE,
        ),
        "cover_package_body": ParagraphStyle(
            "CoverPackageBody",
            fontName="Manual",
            fontSize=8.2,
            leading=11,
            textColor=INK,
        ),
        "part": ParagraphStyle(
            "Part",
            fontName="Manual-Bold",
            fontSize=24,
            leading=30,
            textColor=BLUE,
            spaceAfter=9 * mm,
            alignment=TA_CENTER,
        ),
        "h1": ParagraphStyle(
            "Heading1Manual",
            fontName="Manual-Bold",
            fontSize=19,
            leading=24,
            textColor=BLUE,
            spaceBefore=7 * mm,
            spaceAfter=4 * mm,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "Heading2Manual",
            fontName="Manual-Bold",
            fontSize=14.2,
            leading=19,
            textColor=TEAL,
            spaceBefore=6 * mm,
            spaceAfter=3 * mm,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "Heading3Manual",
            fontName="Manual-Bold",
            fontSize=11.8,
            leading=16,
            textColor=BLUE,
            spaceBefore=4.5 * mm,
            spaceAfter=2.2 * mm,
            keepWithNext=True,
        ),
        "h4": ParagraphStyle(
            "Heading4Manual",
            fontName="Manual-Bold",
            fontSize=10.5,
            leading=15,
            textColor=TEAL,
            spaceBefore=3.5 * mm,
            spaceAfter=1.8 * mm,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "BodyManual",
            fontName="Manual",
            fontSize=10.35,
            leading=15.2,
            alignment=TA_JUSTIFY,
            textColor=INK,
            spaceAfter=2.7 * mm,
            splitLongWords=True,
        ),
        "bullet": ParagraphStyle(
            "BulletManual",
            fontName="Manual",
            fontSize=10.2,
            leading=15,
            leftIndent=7 * mm,
            firstLineIndent=0,
            textColor=INK,
            spaceAfter=1.6 * mm,
        ),
        "number": ParagraphStyle(
            "NumberManual",
            fontName="Manual",
            fontSize=10.2,
            leading=15,
            leftIndent=9 * mm,
            firstLineIndent=-7 * mm,
            textColor=INK,
            spaceAfter=1.7 * mm,
        ),
        "quote": ParagraphStyle(
            "QuoteManual",
            fontName="Manual",
            fontSize=10.1,
            leading=15,
            leftIndent=7 * mm,
            rightIndent=4 * mm,
            borderColor=TEAL,
            borderWidth=1.2,
            borderPadding=(4 * mm, 4 * mm, 4 * mm, 5 * mm),
            backColor=PALE_TEAL,
            textColor=INK,
            spaceBefore=2 * mm,
            spaceAfter=4 * mm,
        ),
        "table_head": ParagraphStyle(
            "TableHead",
            fontName="Manual-Bold",
            fontSize=8.3,
            leading=11,
            textColor=colors.white,
            alignment=TA_LEFT,
        ),
        "table_body": ParagraphStyle(
            "TableBody",
            fontName="Manual",
            fontSize=8.15,
            leading=11.2,
            textColor=INK,
        ),
        "toc_title": ParagraphStyle(
            "TocTitle",
            fontName="Manual-Bold",
            fontSize=22,
            leading=28,
            textColor=BLUE,
            spaceAfter=8 * mm,
        ),
        "caption": ParagraphStyle(
            "ImageCaption",
            fontName="Manual",
            fontSize=8.4,
            leading=11.5,
            alignment=TA_CENTER,
            textColor=MUTED,
            spaceBefore=1.5 * mm,
            spaceAfter=5 * mm,
        ),
    }
    return styles


def inline_markup(text: str) -> str:
    text = html.escape(text.strip())
    text = re.sub(r"`([^`]+)`", r"<font name='Manual-Bold'>\1</font>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", text)
    text = text.replace("EUR", "EUR")
    return text


def clean_source(text: str) -> str:
    # A draft agent appended repeated paragraphs after the real conclusion.
    marker = "\n### Kontrolna ponovitev:"
    if marker in text:
        text = text.split(marker, 1)[0].rstrip() + "\n"

    # Izdaja 8.0 je referenčni priročnik, ne učbenik ali delovni zvezek.
    # Odstranimo celotne učne odseke do naslednjega naslova iste ali višje
    # ravni; tako v dokumentu ne ostanejo odgovori, ocenjevanje ali del naloge.
    excluded_heading = re.compile(
        r"\b("
        r"vaj[ae]?|nalog[ae]?|nasveti?|preverjanje\s+znanja|ocenjena|ocenjevanje|"
        r"trener\w*|mentor\w*|scenarij\w*|primeri\s+iz\s+prakse|"
        r"ključ\s+odgovorov|vprašanja\s+za\s+ponovitev|"
        r"kontrolni\s+seznami?|kontrolna\s+ponovitev|načrt\s+uvajanja|usposabljanje"
        r")\b",
        re.IGNORECASE,
    )
    filtered: list[str] = []
    skipped_level: int | None = None
    for line in text.splitlines():
        heading = re.match(r"^(#{1,6})\s+(.+)$", line.strip())
        if heading:
            level = len(heading.group(1))
            title = re.sub(r"[*`]", "", heading.group(2))
            if skipped_level is not None and level <= skipped_level:
                skipped_level = None
            # A top-level chapter title may legitimately contain a filtered
            # phrase (for example "Slovar, kontrolni seznami ..."). Skipping
            # H1 would suppress the entire source file because no later H1
            # resets skipped_level.
            if skipped_level is None and level > 1 and excluded_heading.search(title):
                skipped_level = level
                continue
        if skipped_level is not None:
            continue
        if re.match(r"^\s*(Nasvet|Naloga|Vaja|Preverjanje znanja)\s*:", line, re.IGNORECASE):
            continue
        filtered.append(line)
    return "\n".join(filtered).strip() + "\n"


def is_table_separator(line: str) -> bool:
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell or "") for cell in cells)


def split_table_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def table_flowable(rows: list[list[str]], styles, width: float) -> Table:
    column_count = max(len(row) for row in rows)
    normalized = [row + [""] * (column_count - len(row)) for row in rows]
    wrapped = []
    for row_index, row in enumerate(normalized):
        style = styles["table_head"] if row_index == 0 else styles["table_body"]
        wrapped.append([Paragraph(inline_markup(cell), style) for cell in row])

    if column_count == 2:
        col_widths = [width * 0.29, width * 0.71]
    elif column_count == 3:
        col_widths = [width * 0.24, width * 0.36, width * 0.40]
    elif column_count == 4:
        col_widths = [width * 0.20, width * 0.25, width * 0.27, width * 0.28]
    else:
        col_widths = [width / column_count] * column_count

    table = Table(wrapped, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), BLUE),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2.3 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2.3 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE_BLUE]),
            ]
        )
    )
    return table


def renumber_headings(text: str, chapter_number: int) -> str:
    """Use clean, sequential display numbers regardless of legacy source gaps."""
    counters = {2: 0, 3: 0, 4: 0}
    numbered: list[str] = []
    for line in text.splitlines():
        heading = re.match(r"^(#{1,4})\s+(.+)$", line.strip())
        if not heading:
            numbered.append(line)
            continue

        marks, raw_title = heading.groups()
        level = len(marks)
        title = re.sub(r"^\d+(?:\.\d+){0,3}\.?\s*", "", raw_title).strip()
        if level == 1:
            display_number = str(chapter_number)
            counters = {2: 0, 3: 0, 4: 0}
        elif level == 2:
            counters[2] += 1
            counters[3] = 0
            counters[4] = 0
            display_number = str(counters[2])
        elif level == 3:
            counters[3] += 1
            counters[4] = 0
            display_number = f"{counters[2]}.{counters[3]}"
        else:
            counters[4] += 1
            display_number = f"{counters[2]}.{counters[3]}.{counters[4]}"
        numbered.append(f"{marks} {display_number}. {title}")
    return "\n".join(numbered)


def markdown_to_flowables(
    text: str,
    styles,
    content_width: float,
    chapter_number: int,
    source_name: str,
    seen_ids: set[str] | None = None,
):
    cleaned, _ = extract_heading_metadata(
        text,
        source_name,
        seen_ids,
        preserve_refs=True,
    )
    cleaned = clean_source(cleaned)
    lines = renumber_headings(cleaned, chapter_number).splitlines()
    story = []
    paragraph_lines: list[str] = []

    def flush_paragraph() -> None:
        if paragraph_lines:
            joined = " ".join(part.strip() for part in paragraph_lines)
            story.append(Paragraph(inline_markup(joined), styles["body"]))
            paragraph_lines.clear()

    index = 0
    while index < len(lines):
        raw = lines[index].rstrip()
        stripped = raw.strip()

        if not stripped or stripped == "---":
            flush_paragraph()
            index += 1
            continue

        if stripped.startswith("|") and index + 1 < len(lines) and is_table_separator(lines[index + 1]):
            flush_paragraph()
            rows = [split_table_row(stripped)]
            index += 2
            while index < len(lines) and lines[index].strip().startswith("|"):
                rows.append(split_table_row(lines[index]))
                index += 1
            story.append(table_flowable(rows, styles, content_width))
            story.append(Spacer(1, 3.5 * mm))
            continue

        image = re.fullmatch(r"!\[([^\]]*)\]\(([^)]+)\)", stripped)
        if image:
            flush_paragraph()
            caption, relative_path = image.groups()
            image_path = ROOT / relative_path
            if not image_path.exists():
                raise FileNotFoundError(image_path)
            rendered = RLImage(str(image_path))
            scale = min(
                content_width / rendered.imageWidth,
                (112 * mm) / rendered.imageHeight,
                1,
            )
            rendered.drawWidth = rendered.imageWidth * scale
            rendered.drawHeight = rendered.imageHeight * scale
            story.append(rendered)
            if caption:
                story.append(Paragraph(inline_markup(caption), styles["caption"]))
            else:
                story.append(Spacer(1, 4 * mm))
            index += 1
            continue

        heading = re.match(r"^(#{1,4})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            title = heading.group(2).strip()
            metadata = HEADING_REF.search(title)
            if metadata is None:
                raise ValueError(
                    f"{source_name}: naslov po filtriranju nima vezanih metapodatkov."
                )
            package = metadata.group(2)
            title = HEADING_REF.sub("", title).strip()
            package_label = PACKAGE_LABELS[package]
            para = Paragraph(
                f"{inline_markup(title)}&nbsp;&nbsp;{package_badge(package)}",
                styles[f"h{level}"],
            )
            para._manual_heading_level = level
            para._manual_heading_text = (
                f"{re.sub(r'[*`]', '', title)} [POS {package_label}]"
            )
            story.append(para)
            index += 1
            continue

        if stripped.startswith(">"):
            flush_paragraph()
            quote_parts = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                quote_parts.append(lines[index].strip().lstrip(">").strip())
                index += 1
            story.append(Paragraph(inline_markup(" ".join(quote_parts)), styles["quote"]))
            continue

        bullet = re.match(r"^[-*]\s+(.+)$", stripped)
        if bullet:
            flush_paragraph()
            body = bullet.group(1)
            marker = "☐" if body.startswith("[ ]") else "•"
            body = re.sub(r"^\[[ xX]\]\s*", "", body)
            story.append(Paragraph(inline_markup(body), styles["bullet"], bulletText=marker))
            index += 1
            continue

        numbered = re.match(r"^(\d+)\.\s+(.+)$", stripped)
        if numbered:
            flush_paragraph()
            prefix = numbered.group(1) + "."
            story.append(
                Paragraph(
                    f"<b>{prefix}</b>&nbsp;&nbsp;{inline_markup(numbered.group(2))}",
                    styles["number"],
                )
            )
            index += 1
            continue

        paragraph_lines.append(stripped)
        index += 1

    flush_paragraph()
    return story


class ManualDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, styles, **kwargs):
        super().__init__(filename, **kwargs)
        self.styles = styles
        self._outline_level = -1
        self._content_start_page: int | None = None
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="manual-frame",
        )
        self.addPageTemplates(
            [PageTemplate(id="manual", frames=[frame], onPageEnd=self.draw_page)]
        )

    def beforeDocument(self) -> None:
        # ReportLab does not allow a PDF outline to jump over a level.
        # Markdown remains semantically unchanged; only PDF bookmarks are
        # clamped when a source goes directly from e.g. H2 to H4.
        self._outline_level = -1
        self._content_start_page = None

    def draw_page(self, canvas, doc) -> None:
        canvas.saveState()
        page = canvas.getPageNumber()
        if page > 1:
            canvas.setStrokeColor(LINE)
            canvas.setLineWidth(0.4)
            canvas.line(18 * mm, 16.5 * mm, A4[0] - 18 * mm, 16.5 * mm)
            canvas.setFont("Manual", 8.2)
            canvas.setFillColor(MUTED)
            canvas.drawString(
                18 * mm,
                11.5 * mm,
                f"POS Gostinstvo — referenčni priročnik v{MANUAL_VERSION}",
            )
            if self._content_start_page is not None:
                logical_page = page - self._content_start_page + 1
                canvas.drawRightString(
                    A4[0] - 18 * mm,
                    11.5 * mm,
                    f"Stran {logical_page}",
                )
        canvas.restoreState()

    def afterFlowable(self, flowable) -> None:
        level = getattr(flowable, "_manual_heading_level", None)
        if level is None:
            return
        text = getattr(flowable, "_manual_heading_text", flowable.getPlainText())
        if level == 1 and text.startswith("DEL ") and self._content_start_page is None:
            self._content_start_page = self.page
        key = f"heading-{self.seq.nextf('heading')}"
        self.canv.bookmarkPage(key)
        outline_level = min(level - 1, self._outline_level + 1)
        self.canv.addOutlineEntry(
            text,
            key,
            level=outline_level,
            closed=outline_level > 1,
        )
        self._outline_level = outline_level
        toc_page = (
            self.page - self._content_start_page + 1
            if self._content_start_page is not None
            else self.page
        )
        self.notify("TOCEntry", (level - 1, text, toc_page, key))


def build_story(styles, doc):
    story = []
    story.extend(
        [
            RLImage(str(LOGO), width=27 * mm, height=28 * mm),
            Spacer(1, 2 * mm),
            Paragraph("Mikrona d.o.o.", styles["cover_meta"]),
            Spacer(1, 11 * mm),
            Paragraph("POS Gostinstvo", styles["cover_title"]),
            Paragraph(
                f"Celovit uporabniški in referenčni priročnik · izdaja {MANUAL_VERSION}",
                styles["cover_subtitle"],
            ),
            Spacer(1, 6 * mm),
            Table(
                [[
                    "Različica",
                    MANUAL_VERSION,
                ], [
                    "Datum izdaje",
                    MANUAL_RELEASE_DATE.strftime("%d.%m.%Y"),
                ]],
                colWidths=[40 * mm, 110 * mm],
                style=TableStyle(
                    [
                        ("FONTNAME", (0, 0), (0, -1), "Manual-Bold"),
                        ("FONTNAME", (1, 0), (1, -1), "Manual"),
                        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
                        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                        ("BACKGROUND", (0, 0), (0, -1), PALE_BLUE),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
                        ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                    ]
                ),
            ),
            Spacer(1, 7 * mm),
            Paragraph("Kaj vključuje posamezen paket?", styles["h2"]),
            Table(
                [
                    [
                        Paragraph("POS Lite", styles["cover_package_title"]),
                        Paragraph(
                            "Prodaja in blagajna, izmene, računi, meni, zaloge, statistika, "
                            "operativna poročila, realizacija, temeljnice, blagajniški premiki, "
                            "obračun ur in nastavitve.",
                            styles["cover_package_body"],
                        ),
                    ],
                    [
                        Paragraph("POS Standard", styles["cover_package_title"]),
                        Paragraph(
                            "<b>Vse iz Lite</b> ter mize, kuhinja, točilnica, pripravljena hrana, "
                            "odpadki s krožnikov in telefonska naročila.",
                            styles["cover_package_body"],
                        ),
                    ],
                    [
                        Paragraph("POS Extended", styles["cover_package_title"]),
                        Paragraph(
                            "<b>Vse iz Standard</b> ter simulacija, rezervacije, dostava, QR meni, "
                            "večhodni meniji, dogodki in slavja, prenosi zaloge ter kavcije, boni in žetoni.",
                            styles["cover_package_body"],
                        ),
                    ],
                ],
                colWidths=[38 * mm, 112 * mm],
                style=TableStyle(
                    [
                        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                        ("BACKGROUND", (0, 0), (0, 0), PALE_BLUE),
                        ("BACKGROUND", (0, 1), (0, 1), PALE_TEAL),
                        ("BACKGROUND", (0, 2), (0, 2), PALE_YELLOW),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
                        ("TOPPADDING", (0, 0), (-1, -1), 2.4 * mm),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.4 * mm),
                    ]
                ),
            ),
            Spacer(1, 7 * mm),
            Paragraph(
                "Priročnik je namenjen natakarjem, kuhinji, točilnici, vodjem izmene, skrbnikom zalog, administratorjem in računovodskim uporabnikom. Opisuje dejanske delovne postopke, pomen polj, posledice potrditev ter ravnanje ob napakah.",
                styles["cover_meta"],
            ),
            PageBreak(),
            Paragraph("Kako uporabljate priročnik", styles["h1"]),
            Paragraph(
                "Priročnik je razdeljen na dvanajst vsebinskih delov. Za iskani postopek uporabite kazalo, preverite predpogoje in sledite oštevilčenim korakom. Opozorila označujejo dejanja, ki jih ne smete ponavljati ali izvajati brez dovoljenja.",
                styles["body"],
            ),
            Paragraph(
                "<b>Pomembno:</b> vidnost gumbov je odvisna od vaše vloge, izbrane poslovne enote, blagajne in naprave. Če navedenega gumba ne vidite, ne uporabljajte prijave druge osebe. Obrnite se na vodjo ali administratorja.",
                styles["quote"],
            ),
            Paragraph("Oznake paketov", styles["h2"]),
            Paragraph(
                "Ob vsakem naslovu je oznaka najnižjega paketa, v katerem je opisana funkcija na voljo. "
                "Višji paket vedno vključuje tudi funkcije nižjih paketov. Strežniške pravice podjetja, "
                "zmožnosti poslovne enote in uporabniška vloga še vedno določajo dejanski dostop.",
                styles["body"],
            ),
            Table(
                [
                    [Paragraph(package_badge("lite"), styles["body"]), Paragraph("<b>Lite</b> — prodaja in blagajna, izmene, računi, meni, zaloge, statistika, operativna poročila, realizacija, temeljnice, blagajniški premiki, obračun ur in nastavitve.", styles["body"])],
                    [Paragraph(package_badge("standard"), styles["body"]), Paragraph("<b>Standard</b> — vse iz Lite ter mize, kuhinja, točilnica, pripravljena hrana, odpadki s krožnikov in telefonska naročila.", styles["body"])],
                    [Paragraph(package_badge("extended"), styles["body"]), Paragraph("<b>Extended</b> — vse iz Standard ter simulacija, rezervacije, dostava, QR meni, večhodni meniji, dogodki in slavja, prenosi zaloge ter kavcije, boni in žetoni.", styles["body"])],
                ],
                colWidths=[35 * mm, 115 * mm],
                style=TableStyle([
                    ("GRID", (0, 0), (-1, -1), 0.4, LINE),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
                    ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
                ]),
            ),
            Spacer(1, 5 * mm),
            Paragraph("Kazalo", styles["toc_title"]),
        ]
    )

    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(
            "TOC0",
            fontName="Manual-Bold",
            fontSize=10.2,
            leading=15,
            leftIndent=0,
            firstLineIndent=0,
            textColor=BLUE,
            spaceBefore=2 * mm,
        ),
        ParagraphStyle(
            "TOC1",
            fontName="Manual",
            fontSize=9.2,
            leading=13,
            leftIndent=7 * mm,
            firstLineIndent=0,
            textColor=INK,
        ),
        ParagraphStyle(
            "TOC2",
            fontName="Manual",
            fontSize=8.6,
            leading=12,
            leftIndent=14 * mm,
            firstLineIndent=0,
            textColor=MUTED,
        ),
        ParagraphStyle(
            "TOC3",
            fontName="Manual",
            fontSize=8.2,
            leading=11,
            leftIndent=21 * mm,
            firstLineIndent=0,
            textColor=MUTED,
        ),
    ]
    story.extend([toc, PageBreak()])

    seen_heading_ids: set[str] = set()
    for chapter_number, (numeral, title, filename) in enumerate(SOURCE_FILES, start=1):
        path = SOURCE_DIR / filename
        if not path.exists():
            raise FileNotFoundError(path)
        source = path.read_text(encoding="utf-8")
        invalid_dates = sorted(set(NON_SLOVENIAN_DATE.findall(source)))
        if invalid_dates:
            raise ValueError(
                f"{filename} vsebuje datume zunaj oblike dd.mm.yyyy: "
                + ", ".join(invalid_dates)
            )
        part = Paragraph(f"DEL {numeral}<br/><br/>{html.escape(title)}", styles["part"])
        part._manual_heading_level = 1
        part._manual_heading_text = f"DEL {numeral}: {title}"
        story.extend(
            [
                Spacer(1, 45 * mm),
                part,
                Spacer(1, 10 * mm),
                Paragraph(
                    "V tem delu so zbrani preverjeni postopki in reševanje napak za navedeno področje.",
                    styles["cover_meta"],
                ),
                PageBreak(),
            ]
        )
        flowables = markdown_to_flowables(
            source,
            styles,
            doc.width,
            chapter_number,
            filename,
            seen_heading_ids,
        )
        if not flowables:
            raise ValueError(f"{filename} po filtriranju nima vsebine")
        story.extend(flowables)
        story.append(PageBreak())

    story.extend([
        Spacer(1, 45 * mm),
        Paragraph("Konec priročnika", styles["part"]),
        Paragraph(
            "Ob spremembah nastavitev ali postopkov vedno preverite trenutno stanje v svoji poslovni enoti.",
            styles["cover_meta"],
        ),
    ])
    return story


def main() -> None:
    register_fonts()
    styles = make_styles()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = ManualDocTemplate(
        str(OUTPUT),
        styles,
        pagesize=A4,
        leftMargin=19 * mm,
        rightMargin=19 * mm,
        topMargin=18 * mm,
        bottomMargin=21 * mm,
        title=f"POS Gostinstvo — celovit uporabniški in referenčni priročnik v{MANUAL_VERSION}",
        author="Bookie",
        subject="Uporabniški priročnik za POS Gostinstvo",
        creator="Bookie POS Gostinstvo",
    )
    story = build_story(styles, doc)
    doc.multiBuild(story)
    PUBLIC_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_OUTPUT.write_bytes(OUTPUT.read_bytes())
    print(OUTPUT)


if __name__ == "__main__":
    main()