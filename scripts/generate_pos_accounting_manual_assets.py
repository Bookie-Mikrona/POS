#!/usr/bin/env python3
"""Create annotated accounting-manual figures from reviewed application captures."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "pos-accounting-manual-images"
OUT.mkdir(parents=True, exist_ok=True)

FIGURES = {
    "00-pregled-modula.jpg": ("docs/pos-manual-images/19-porocila.jpg", "Računovodski pregled modula POS Gostinstvo"),
    "01-nastavitve-knjizenja.jpg": ("docs/pos-manual-images/20-nastavitve.jpg", "Nastavitve knjiženja in privzetih kontov"),
    "02-default-konti-prodaja.jpg": ("docs/pos-manual-images/20-nastavitve.jpg", "Privzeti konti prodaje, plačil in DDV"),
    "03-default-konti-zaloga.jpg": ("docs/pos-manual-images/20-nastavitve.jpg", "Privzeti konti nabave, zaloge in porabe"),
    "04-kategorije-prihodki.jpg": ("docs/pos-manual-images/10-meni.jpg", "Kategorije artiklov in prihodkovni konti"),
    "05-izdaja-racuna.jpg": ("docs/pos-manual-images/04-blagajna.jpg", "Izdaja računa: način plačila in zaključek"),
    "06-seznam-temeljnic.jpg": ("docs/pos-manual-images/19-porocila.jpg", "Seznam dnevnih temeljnic in filtri"),
    "07-nastavitve-kontov.jpg": ("docs/pos-manual-images/20-nastavitve.jpg", "Konti, ki jih uporabi tvorba temeljnice"),
    "08-predogled-temeljnice.jpg": ("screenshots/erp-dev-check.jpg", "Predogled temeljnice: konti, D/K in zneski"),
    "09-karticna-placila.jpg": ("docs/pos-manual-images/04-blagajna.jpg", "Kartično plačilo in kontrola terminala"),
    "10-darilni-boni.jpg": ("docs/pos-manual-images/08-racuni.jpg", "Darilni bon: izdaja, unovčenje in sled"),
    "11-storno-furs.jpg": ("docs/pos-manual-images/08-racuni.jpg", "Storno računa in status FURS"),
    "12-dnevna-temeljnica.jpg": ("docs/pos-manual-images/19-porocila.jpg", "Dnevna temeljnica POS → glavna knjiga"),
    "13-seznam-temeljnic.jpg": ("screenshots/erp-dev-check.jpg", "Seznam temeljnic in statusi"),
    "14-predogled-temeljnice.jpg": ("screenshots/erp-dev-check.jpg", "Razširjena temeljnica z nazivi kontov"),
    "15-izvoz-temeljnice.jpg": ("docs/pos-manual-images/19-porocila.jpg", "Kontrola in izvoz temeljnice"),
    "16-prejemnica.jpg": ("docs/pos-manual-images/12-prejemnica.jpg", "Prejemnica in predogled knjiženja"),
    "17-ddv-prejemnica.jpg": ("docs/pos-manual-images/13-ocr.jpg", "Vrstice prejemnice in stopnje DDV"),
    "18-embalaza-vracilo.jpg": ("screenshots/povratna-embalaza-zaloge.jpg", "Povratna embalaža: prevzem, saldo in vračilo"),
    "19-zacetna-zaloga.jpg": ("docs/pos-manual-images/11-zaloge.jpg", "Vnos začetne zaloge"),
    "20-inventura.jpg": ("docs/pos-manual-images/11-zaloge.jpg", "Inventura: knjižno in dejansko stanje"),
    "21-kalo-pripravljena-hrana.jpg": ("docs/pos-manual-images/14-pripravljena-hrana.jpg", "Pripravljena hrana in zapisnik kala"),
    "22-pripravljena-hrana-ledger.jpg": ("docs/pos-manual-images/14-pripravljena-hrana.jpg", "Dnevna evidenca pripravljene hrane"),
    "23-odpadki-s-kroznikov.jpg": ("docs/pos-manual-images/15-odpadki.jpg", "Ločena evidenca odpadkov s krožnikov"),
    "24-dogodek-prenos.jpg": ("screenshots/pos-dogodki-final.jpg", "Prenos zaloge na dogodek in vračilo"),
    "25-blagajniski-premiki.jpg": ("docs/pos-manual-images/04-blagajna.jpg", "Blagajniški polog, dvig in izplačilo"),
    "26-karticni-kliring.jpg": ("docs/pos-manual-images/19-porocila.jpg", "Kartični kliring in uskladitev"),
    "27-kontrola-napak.jpg": ("docs/pos-manual-images/19-porocila.jpg", "Kontrola preskočenih in nepopolnih knjižb"),
    "28-robni-primeri.jpg": ("docs/pos-manual-images/19-porocila.jpg", "Končna kontrola robnih primerov"),
}

FONT_BOLD = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
FONT_SMALL = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)

for filename, (source, title) in FIGURES.items():
    image = Image.open(ROOT / source).convert("RGB")
    target_width = 1440
    ratio = target_width / image.width
    image = image.resize((target_width, round(image.height * ratio)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (target_width, image.height + 92), "#163A5F")
    canvas.paste(image, (0, 92))
    draw = ImageDraw.Draw(canvas)
    draw.text((32, 18), title, font=FONT_BOLD, fill="white")
    draw.text((32, 57), "Zaslonska slika programa — poudarek za računovodski primer", font=FONT_SMALL, fill="#D8EEF1")
    canvas.save(OUT / filename, quality=91, optimize=True)

print(f"Ustvarjenih slik: {len(FIGURES)}")