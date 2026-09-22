from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

OUT = Path(".agents/outputs/bookie-pos-gostinstvo-paketi.pdf")
OUT.parent.mkdir(parents=True, exist_ok=True)

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
pdfmetrics.registerFont(TTFont("BookieSans", str(FONT_DIR / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("BookieSans-Bold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))

NAVY = colors.HexColor("#102A43")
BLUE = colors.HexColor("#1677FF")
CYAN = colors.HexColor("#29B6C8")
PALE_BLUE = colors.HexColor("#EAF3FF")
PALE_CYAN = colors.HexColor("#EAF9FA")
LIGHT = colors.HexColor("#F5F7FA")
MID = colors.HexColor("#66788A")
DARK = colors.HexColor("#1D2A36")
GREEN = colors.HexColor("#168B61")
GOLD = colors.HexColor("#B7791F")
WHITE = colors.white

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="BodyBookie", parent=styles["BodyText"], fontName="BookieSans",
    fontSize=9.2, leading=13.4, textColor=DARK, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="SmallBookie", parent=styles["BodyText"], fontName="BookieSans",
    fontSize=7.5, leading=10.2, textColor=MID,
))
styles.add(ParagraphStyle(
    name="H1Bookie", parent=styles["Heading1"], fontName="BookieSans-Bold",
    fontSize=22, leading=27, textColor=NAVY, spaceBefore=5, spaceAfter=12,
))
styles.add(ParagraphStyle(
    name="H2Bookie", parent=styles["Heading2"], fontName="BookieSans-Bold",
    fontSize=14, leading=18, textColor=NAVY, spaceBefore=10, spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="H3Bookie", parent=styles["Heading3"], fontName="BookieSans-Bold",
    fontSize=10.5, leading=14, textColor=BLUE, spaceBefore=6, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="CoverTitle", parent=styles["Title"], fontName="BookieSans-Bold",
    fontSize=29, leading=34, textColor=WHITE, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="CoverSub", parent=styles["BodyText"], fontName="BookieSans",
    fontSize=13, leading=19, textColor=colors.HexColor("#DCEBFF"),
))
styles.add(ParagraphStyle(
    name="CardTitle", parent=styles["Heading2"], fontName="BookieSans-Bold",
    fontSize=13, leading=16, textColor=WHITE, alignment=TA_CENTER,
))
styles.add(ParagraphStyle(
    name="CardPrice", parent=styles["Heading1"], fontName="BookieSans-Bold",
    fontSize=17, leading=20, textColor=NAVY, alignment=TA_CENTER,
))
styles.add(ParagraphStyle(
    name="TableHead", parent=styles["BodyText"], fontName="BookieSans-Bold",
    fontSize=8, leading=10, textColor=WHITE, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="TableCell", parent=styles["BodyText"], fontName="BookieSans",
    fontSize=7.5, leading=10, textColor=DARK,
))


def p(text, style="BodyBookie"):
    return Paragraph(text, styles[style])


def bullets(items, color=BLUE):
    rows = []
    for item in items:
        rows.append([
            Paragraph("●", ParagraphStyle(
                "dot", fontName="BookieSans", fontSize=6.5, textColor=color, leading=11
            )),
            p(item),
        ])
    table = Table(rows, colWidths=[5 * mm, 157 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    return table


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, A4[1] - 12 * mm, A4[0], 12 * mm, fill=1, stroke=0)
    canvas.setFont("BookieSans-Bold", 8)
    canvas.setFillColor(WHITE)
    canvas.drawString(18 * mm, A4[1] - 7.8 * mm, "BOOKIE POS GOSTINSTVO")
    canvas.setFont("BookieSans", 7)
    canvas.setFillColor(MID)
    canvas.drawString(18 * mm, 10 * mm, "Predlog paketov in poti implementacije")
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Stran {doc.page}")
    canvas.restoreState()


def cover(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    canvas.setFillColor(BLUE)
    canvas.circle(w - 10 * mm, h - 5 * mm, 58 * mm, fill=1, stroke=0)
    canvas.setFillColor(CYAN)
    canvas.circle(w - 5 * mm, 25 * mm, 40 * mm, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("BookieSans-Bold", 12)
    canvas.drawString(22 * mm, h - 28 * mm, "BOOKIE")
    canvas.setFont("BookieSans", 8)
    canvas.setFillColor(colors.HexColor("#DCEBFF"))
    canvas.drawRightString(w - 22 * mm, 18 * mm, "Osnutek • 22.09.2026")
    canvas.restoreState()


doc = BaseDocTemplate(
    str(OUT), pagesize=A4,
    leftMargin=18 * mm, rightMargin=18 * mm,
    topMargin=20 * mm, bottomMargin=18 * mm,
    title="Bookie POS Gostinstvo – predlog paketov in implementacije",
    author="Bookie / Mikrona",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="content")
doc.addPageTemplates([
    PageTemplate(id="cover", frames=frame, onPage=cover),
    PageTemplate(id="normal", frames=frame, onPage=header_footer),
])

story = [
    Spacer(1, 52 * mm),
    p("POS GOSTINSTVO", "CoverSub"),
    Spacer(1, 5 * mm),
    p("Predlog paketov<br/>Lite, Standard in Extended", "CoverTitle"),
    Spacer(1, 8 * mm),
    p("Komercialna zasnova in najpreprostejša pot implementacije v obstoječi aplikaciji Bookie POS.", "CoverSub"),
    NextPageTemplate("normal"),
    PageBreak(),
]

story += [
    p("Povzetek predloga", "H1Bookie"),
    p("Bookie POS naj ostane ena aplikacija z enim podatkovnim modelom. Paketi ne pomenijo treh ločenih različic programa, ampak določajo zgornjo mejo funkcij, ki so podjetju na voljo."),
    Spacer(1, 3 * mm),
]

cards = []
for title, price, audience, color in [
    ("LITE", "24,90 €", "Majhni bari, kioski, stojnice in preprosta prodaja", GREEN),
    ("STANDARD", "49,90 €", "Glavni paket za bare, kavarne, gostilne in restavracije", BLUE),
    ("EXTENDED", "89,90 €", "KDS, QR, rezervacije, dostava, dogodki in več lokacij", GOLD),
]:
    cards.append(Table([
        [p(title, "CardTitle")],
        [p(f"{price}<br/><font size='8'>brez DDV / mesec / enoto</font>", "CardPrice")],
        [p(audience, "SmallBookie")],
    ], colWidths=[52 * mm], rowHeights=[12 * mm, 22 * mm, 25 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), color),
        ("BACKGROUND", (0, 1), (0, -1), WHITE),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#D7E0E8")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ])))

card_table = Table([cards], colWidths=[56 * mm] * 3, hAlign="CENTER")
card_table.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 2),
    ("RIGHTPADDING", (0, 0), (-1, -1), 2),
]))
story += [card_table, Spacer(1, 7 * mm)]

story += [
    p("Temeljna odločitev", "H2Bookie"),
    bullets([
        "<b>Modul POS</b> določa, ali ima podjetje dostop do aplikacije.",
        "<b>Paket</b> Lite, Standard ali Extended določa največji dovoljeni nabor funkcij.",
        "<b>Profil poslovne enote</b> določa, katere od dovoljenih funkcij enota dejansko uporablja.",
        "Dejanske funkcije so presek nastavitev enote in dovoljenj izbranega paketa.",
        "V prvi izdaji paket nastavlja samo superadministrator; avtomatsko obračunavanje ni potrebno.",
    ]),
    Spacer(1, 4 * mm),
    Table([[p("<b>Priporočilo:</b> Standard naj bo glavni prodajni paket. Lite je vstopna, vendar uporabna blagajna. Extended združi funkcije z največjo poslovno vrednostjo.", "BodyBookie")]],
          colWidths=[169 * mm], style=TableStyle([
              ("BACKGROUND", (0, 0), (-1, -1), PALE_BLUE),
              ("BOX", (0, 0), (-1, -1), 0.7, BLUE),
              ("LEFTPADDING", (0, 0), (-1, -1), 10),
              ("RIGHTPADDING", (0, 0), (-1, -1), 10),
              ("TOPPADDING", (0, 0), (-1, -1), 8),
              ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
          ])),
    PageBreak(),
]

story += [
    p("Vsebina paketov", "H1Bookie"),
    p("Vsi paketi vključujejo davčno potrjevanje računov, gotovinska in kartična plačila, zaposlene oziroma natakarje s PIN-om, artikle in cenike, izmene, pregled računov, varnostne posodobitve in pomoč na daljavo."),
]

package_rows = [
    [p("Področje", "TableHead"), p("Lite", "TableHead"), p("Standard", "TableHead"), p("Extended", "TableHead")],
    [p("Blagajna in FURS", "TableCell"), p("Vključeno", "TableCell"), p("Vključeno", "TableCell"), p("Vključeno", "TableCell")],
    [p("Izmene, računi in ceniki", "TableCell"), p("Osnovno", "TableCell"), p("Napredno", "TableCell"), p("Napredno", "TableCell")],
    [p("Zaloga in inventure", "TableCell"), p("Osnovno", "TableCell"), p("Normativi in odpisi", "TableCell"), p("Napredna zaloga in prenosi", "TableCell")],
    [p("Mize in tloris", "TableCell"), p("—", "TableCell"), p("Vključeno", "TableCell"), p("Vključeno", "TableCell")],
    [p("Kuhinja in točilnica", "TableCell"), p("—", "TableCell"), p("Tisk in osnovni statusi", "TableCell"), p("Več KDS oddelkov", "TableCell")],
    [p("Mobilni natakar", "TableCell"), p("—", "TableCell"), p("Vključeno", "TableCell"), p("Vključeno", "TableCell")],
    [p("QR-meni in naročanje", "TableCell"), p("—", "TableCell"), p("Doplačilo", "TableCell"), p("Vključeno", "TableCell")],
    [p("Rezervacije", "TableCell"), p("—", "TableCell"), p("Doplačilo", "TableCell"), p("Vključeno", "TableCell")],
    [p("Dostava in prevzem", "TableCell"), p("—", "TableCell"), p("Prevzem / doplačilo", "TableCell"), p("Vključeno", "TableCell")],
    [p("Dogodki in slavja", "TableCell"), p("—", "TableCell"), p("—", "TableCell"), p("Vključeno", "TableCell")],
    [p("Večhodni meniji", "TableCell"), p("—", "TableCell"), p("—", "TableCell"), p("Vključeno", "TableCell")],
    [p("Več poslovnih enot", "TableCell"), p("Vsaka posebej", "TableCell"), p("Vsaka posebej", "TableCell"), p("Centralni pregled", "TableCell")],
]
package_table = Table(package_rows, colWidths=[48 * mm, 37 * mm, 42 * mm, 42 * mm], repeatRows=1)
package_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), NAVY),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CED8E2")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story += [package_table, Spacer(1, 5 * mm)]

story += [
    p("Lite — 24,90 €", "H2Bookie"),
    p("Za manjše bare, kioske, stojnice, food trucke in prodajna mesta, kjer se račun večinoma izda takoj."),
    bullets([
        "Blagajna, računi, osnovna plačila, izmene, artikli, ceniki in popusti.",
        "Osnovno spremljanje zaloge, inventura, statistika, realizacija in blagajniški premiki.",
        "Ena poslovna enota in ena aktivna blagajna.",
    ], GREEN),
    p("Standard — 49,90 €", "H2Bookie"),
    p("Glavni paket za bare, kavarne, gostilne, restavracije, picerije in hitro prehrano."),
    bullets([
        "Vse iz Lite ter mize, tloris, odprta naročila, delitev računov in mešana plačila.",
        "Kuhinja, točilnica, tiskanje naročil, pripravljena hrana, normativi in odpisi.",
        "Telefonska naročila, prevzem, mobilni natakar in poročila po natakarjih ter kategorijah.",
    ]),
    PageBreak(),
]

story += [
    p("Extended — 89,90 €", "H1Bookie"),
    p("Za večje restavracije, hotele, catering, dogodke, dostavo in lokale z več pripravljalnimi oddelki."),
    bullets([
        "Napredni KDS z ločenimi zasloni za kuhinjo, pico, žar, solate, točilnico in izdajo.",
        "QR-meni, QR-naročanje, rezervacije, dostava, vozniki in statusi dostave.",
        "Večhodni meniji, dogodki, pogostitve, prireditvene točke in prenosi zaloge.",
        "Kavcije, boni in žetoni, napredne inventure, centralni pregled in integracije.",
    ], GOLD),
    p("Enterprise oziroma verige", "H2Bookie"),
    p("Cena po ponudbi. Namenjeno več podjetjem ali večjemu številu enot, centralnim cenikom in normativom, lastnim integracijam, API-ju, migraciji podatkov ter dogovorjenemu odzivnemu času podpore."),
    p("Predlagana doplačila", "H2Bookie"),
]

addon_rows = [
    [p("Dodatek", "TableHead"), p("Predlagana cena brez DDV", "TableHead")],
    [p("Dodatna blagajna ali mobilni natakar", "TableCell"), p("7,90 € / mesec", "TableCell")],
    [p("Dodatni KDS zaslon", "TableCell"), p("9,90 € / mesec", "TableCell")],
    [p("QR-naročanje za Standard", "TableCell"), p("14,90 € / mesec", "TableCell")],
    [p("Dostava za Standard", "TableCell"), p("14,90 € / mesec", "TableCell")],
    [p("Rezervacije za Standard", "TableCell"), p("9,90 € / mesec", "TableCell")],
    [p("Uvedba in začetna nastavitev", "TableCell"), p("99–249 € enkratno", "TableCell")],
    [p("Uvoz artiklov in cenikov", "TableCell"), p("od 49 € enkratno", "TableCell")],
]
addon_table = Table(addon_rows, colWidths=[110 * mm, 59 * mm], repeatRows=1)
addon_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), NAVY),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CED8E2")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story += [
    addon_table,
    Spacer(1, 5 * mm),
    Table([[p("<b>Prva izdaja:</b> doplačil še ni treba tehnično avtomatizirati. Najprej se uvedejo trije osnovni paketi, dodatki pa se po potrebi nastavijo ročno.", "BodyBookie")]],
          colWidths=[169 * mm], style=TableStyle([
              ("BACKGROUND", (0, 0), (-1, -1), PALE_CYAN),
              ("BOX", (0, 0), (-1, -1), 0.7, CYAN),
              ("LEFTPADDING", (0, 0), (-1, -1), 9),
              ("RIGHTPADDING", (0, 0), (-1, -1), 9),
              ("TOPPADDING", (0, 0), (-1, -1), 7),
              ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
          ])),
    PageBreak(),
]

story += [
    p("Najpreprostejša tehnična izvedba", "H1Bookie"),
    p("Obstoječi projekt že vsebuje module podjetja, profile gostinskih enot, granularne zmožnosti, filtriranje navigacije, strežniško zaščito in superadministratorski del. Zato je potreben le tanek sloj paketnih dovoljenj."),
    p("1. Ena nova tabela", "H2Bookie"),
    p("Doda se tabela <b>company_pos_plans</b> z osnovnimi polji: company_id, plan, enabled_at in enabled_by. Modul <b>pos</b> ostane tehnični vklop aplikacije, paket pa določa poslovni obseg funkcij."),
    p("2. En centralni katalog paketov", "H2Bookie"),
]

cap_rows = [
    [p("Paket", "TableHead"), p("Zmožnosti", "TableHead")],
    [p("Lite", "TableCell"), p("checkout, shifts, receipts, menu, inventory, statistics, operational_reports, realization, journals, cash_movements, hours, settings", "TableCell")],
    [p("Standard", "TableCell"), p("Vse iz Lite + tables, kitchen, bar, prepared_food, plate_waste, phone_orders", "TableCell")],
    [p("Extended", "TableCell"), p("Vse iz Standard + reservations, delivery, qr_menu, multi_course, self_service, events, stock_transfers, deposits_tokens", "TableCell")],
]
cap_table = Table(cap_rows, colWidths=[28 * mm, 141 * mm], repeatRows=1)
cap_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), NAVY),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CED8E2")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story += [
    cap_table,
    p("3. Izračun dejanskih dovoljenj", "H2Bookie"),
    Table([[p("<b>nastavitve enote</b>", "BodyBookie"), p("∩", "H2Bookie"), p("<b>dovoljenja paketa</b>", "BodyBookie"), p("=", "H2Bookie"), p("<b>dejanske funkcije</b>", "BodyBookie")]],
          colWidths=[44 * mm, 10 * mm, 48 * mm, 10 * mm, 50 * mm],
          style=TableStyle([
              ("BACKGROUND", (0, 0), (-1, -1), PALE_BLUE),
              ("BOX", (0, 0), (-1, -1), 0.7, BLUE),
              ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
              ("ALIGN", (0, 0), (-1, -1), "CENTER"),
              ("TOPPADDING", (0, 0), (-1, -1), 7),
              ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
          ])),
    Spacer(1, 3 * mm),
    p("Profil Bar tako ne dobi kuhinje samo zato, ker jo paket Standard dovoljuje. Paket je zgornja meja, profil pa dejanska konfiguracija lokala."),
    PageBreak(),
]

story += [
    p("Varnost in upravljanje", "H1Bookie"),
    p("4. Strežniška zaščita", "H2Bookie"),
    bullets([
        "Preveri se, ali ima podjetje omogočen modul POS.",
        "Prebere se paket podjetja.",
        "Preveri se, ali paket dovoljuje zahtevano zmožnost.",
        "Preveri se, ali je zmožnost vključena v poslovni enoti.",
        "Če katerikoli pogoj ni izpolnjen, API vrne 403.",
    ]),
    p("Samo skrivanje elementov v uporabniškem vmesniku ni dovolj. Enaka pravila morajo veljati na strežniku."),
    p("5. Izbira paketa v SuperAdminu", "H2Bookie"),
    p("Na kartico podjetja se doda izbira <b>Lite / Standard / Extended</b>, prikaz trenutnega paketa, datum spremembe in izvajalec spremembe. V prvi različici paket spreminja samo superadministrator."),
    p("6. Zaklenjene funkcije v nastavitvah", "H2Bookie"),
    p("Funkcije višjega paketa se prikažejo onemogočene z oznako »Na voljo v paketu Extended«. Tako uporabnik razume omejitev in hkrati vidi možnost nadgradnje."),
    Spacer(1, 3 * mm),
    Table([
        [p("☑ Blagajna", "BodyBookie")],
        [p("☑ Mize in prostori", "BodyBookie")],
        [p("☑ Kuhinja", "BodyBookie")],
        [p("🔒 Rezervacije — paket Extended", "BodyBookie")],
        [p("🔒 Dostava — paket Extended", "BodyBookie")],
        [p("🔒 QR-meni — paket Extended", "BodyBookie")],
    ], colWidths=[95 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#CED8E2")),
        ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#DDE5EC")),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ])),
    p("Česa v prvi različici ne izvajamo", "H2Bookie"),
    bullets([
        "Avtomatskega plačevanja naročnine in spreminjanja paketa s strani stranke.",
        "Preračunavanja naročnine sredi meseca in samodejne blokade zaradi neplačila.",
        "Merjenja uporabe, omejevanja števila računov ali posameznih plačljivih dodatkov.",
        "Različnih paketov po uporabnikih oziroma poslovnih enotah istega podjetja.",
    ], GOLD),
    PageBreak(),
]

story += [
    p("Zaporedje uvedbe", "H1Bookie"),
]

phases = [
    ("1", "Podatkovni model", "Tabela za paket podjetja, privzeti paket za obstoječe stranke in centralni katalog zmožnosti."),
    ("2", "Strežniška zaščita", "Izračun dejanskih dovoljenj, vključitev v obstoječe API preverjanje in testi prepovedanih klicev."),
    ("3", "Uporabniški vmesnik", "Izbira paketa v SuperAdminu, prikaz trenutnega paketa ter zaklenjene funkcije v nastavitvah."),
    ("4", "Komercialna uvedba", "Cenik, ponudba, pogodbeni pogoji in ročno izdajanje naročnin. Avtomatizacija sledi pozneje."),
]
for num, title, desc in phases:
    block = Table([
        [p(num, "CardTitle"), p(title, "H3Bookie")],
        ["", p(desc)],
    ], colWidths=[16 * mm, 151 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), BLUE),
        ("SPAN", (0, 0), (0, 1)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#D7E0E8")),
        ("LEFTPADDING", (1, 0), (1, -1), 9),
        ("RIGHTPADDING", (1, 0), (1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story += [KeepTogether(block), Spacer(1, 4 * mm)]

story += [
    p("Pravila prehoda", "H2Bookie"),
    bullets([
        "Vsa obstoječa aktivna podjetja ob uvedbi dobijo paket Extended, zato ne izgubijo nobene funkcije.",
        "Nova podjetja ob aktivaciji dobijo ročno izbrani paket.",
        "Znižanje paketa ne briše podatkov; samo prepreči uporabo funkcij, ki niso več dovoljene.",
        "Ponovna nadgradnja takoj povrne dostop do obstoječih podatkov.",
        "Sprememba paketa se zabeleži zaradi revizijske sledljivosti.",
    ]),
    Spacer(1, 4 * mm),
    Table([[p("<b>Končno priporočilo:</b> ena aplikacija, en paket na podjetje, ročno upravljanje v SuperAdminu in strežniško uveljavljanje obstoječih zmožnosti. To je najhitrejša pot z najmanjšim tveganjem in brez podvajanja kode.", "BodyBookie")]],
          colWidths=[169 * mm], style=TableStyle([
              ("BACKGROUND", (0, 0), (-1, -1), PALE_BLUE),
              ("BOX", (0, 0), (-1, -1), 0.9, BLUE),
              ("LEFTPADDING", (0, 0), (-1, -1), 11),
              ("RIGHTPADDING", (0, 0), (-1, -1), 11),
              ("TOPPADDING", (0, 0), (-1, -1), 10),
              ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
          ])),
]

doc.build(story)
print(OUT)