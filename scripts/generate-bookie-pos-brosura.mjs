import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireFromApi = createRequire(path.resolve("artifacts/api-server/package.json"));
const PDFDocument = requireFromApi("pdfkit");

const outputPath = path.resolve("docs/BOOKIE-ERP-POS-Gostinstvo-reklamni-dokument.pdf");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const W = 595.28;
const H = 841.89;
const M = 44;
const C = {
  ink: "#111827",
  navy: "#071426",
  navy2: "#0D203A",
  blue: "#1E5EFF",
  cyan: "#6EE7F9",
  gold: "#F6B73C",
  cream: "#F7F8FA",
  white: "#FFFFFF",
  muted: "#687386",
  line: "#DCE2EB",
  softBlue: "#EAF0FF",
  softGold: "#FFF4D8",
  green: "#2DB788",
};

const regular = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const mono = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf";

const doc = new PDFDocument({
  size: "A4",
  margin: 0,
  autoFirstPage: false,
  info: {
    Title: "BOOKIE-ERP POS Gostinstvo",
    Author: "BOOKIE-ERP",
    Subject: "Predstavitveni dokument za gostinske lokale in obrate",
  },
});

doc.registerFont("Regular", regular);
doc.registerFont("Bold", bold);
doc.registerFont("Mono", mono);
doc.pipe(fs.createWriteStream(outputPath));

function page(bg = C.cream) {
  doc.addPage({ size: "A4", margin: 0 });
  doc.rect(0, 0, W, H).fill(bg);
}

function rect(x, y, w, h, fill, radius = 0, stroke = null) {
  if (radius) doc.roundedRect(x, y, w, h, radius);
  else doc.rect(x, y, w, h);
  if (fill) doc.fillColor(fill).fill();
  if (stroke) {
    if (radius) doc.roundedRect(x, y, w, h, radius);
    else doc.rect(x, y, w, h);
    doc.lineWidth(1).strokeColor(stroke).stroke();
  }
}

function text(value, x, y, opts = {}) {
  const {
    size = 10,
    color = C.ink,
    font = "Regular",
    width = W - x - M,
    lineGap = 2,
    align = "left",
    continued = false,
  } = opts;
  doc.font(font).fontSize(size).fillColor(color);
  doc.text(value, x, y, { width, lineGap, align, continued });
  return doc.y;
}

function label(value, x, y, color = C.blue) {
  return text(value.toUpperCase(), x, y, {
    size: 8,
    color,
    font: "Bold",
    lineGap: 0,
  });
}

function rule(x, y, w, color = C.line) {
  doc.moveTo(x, y).lineTo(x + w, y).lineWidth(1).strokeColor(color).stroke();
}

function logo(x, y, scale = 1, dark = false) {
  const size = 28 * scale;
  rect(x, y, size, size, dark ? C.white : C.ink, 7 * scale);
  rect(x + 8 * scale, y + 8 * scale, 4 * scale, 13 * scale, dark ? C.ink : C.white, 1 * scale);
  rect(x + 14 * scale, y + 12 * scale, 6 * scale, 9 * scale, dark ? C.ink : C.white, 1 * scale);
  doc.circle(x + 17 * scale, y + 8 * scale, 1.5 * scale).fillColor(dark ? C.ink : C.white).fill();
}

function brand(x, y, dark = false) {
  logo(x, y, 0.95, dark);
  text("BOOKIE-ERP", x + 38, y + 3, {
    size: 12,
    color: dark ? C.white : C.ink,
    font: "Bold",
    lineGap: 0,
  });
  text("POS GOSTINSTVO", x + 38, y + 17, {
    size: 7,
    color: dark ? "#A7B5C8" : C.muted,
    font: "Bold",
    lineGap: 0,
  });
}

function footer(pageNo, dark = false) {
  const color = dark ? "#8192A9" : "#8792A3";
  rule(M, H - 43, W - M * 2, dark ? "#28405E" : C.line);
  text("BOOKIE-ERP  •  GOSTINSTVO", M, H - 29, { size: 7, color, font: "Bold", lineGap: 0 });
  text(String(pageNo).padStart(2, "0"), W - M - 20, H - 29, { size: 7, color, font: "Bold", align: "right", lineGap: 0, width: 20 });
}

function pill(value, x, y, w, fill, color, border = null) {
  rect(x, y, w, 22, fill, 11, border);
  text(value, x, y + 6, { size: 7.5, color, font: "Bold", width: w, align: "center", lineGap: 0 });
}

function dot(x, y, color = C.gold, r = 3) {
  doc.circle(x, y, r).fillColor(color).fill();
}

function check(x, y, color = C.blue) {
  doc.lineWidth(1.6).strokeColor(color);
  doc.moveTo(x, y + 5).lineTo(x + 4, y + 9).lineTo(x + 11, y).stroke();
}

function featureCard(x, y, w, h, icon, title, body, dark = false, accent = C.blue) {
  rect(x, y, w, h, dark ? C.navy2 : C.white, 12, dark ? "#26415F" : C.line);
  rect(x + 16, y + 16, 30, 30, dark ? "#173454" : C.softBlue, 9);
  text(icon, x + 16, y + 21, { size: 13, color: dark ? C.cyan : accent, font: "Bold", width: 30, align: "center", lineGap: 0 });
  text(title, x + 16, y + 59, { size: 11, color: dark ? C.white : C.ink, font: "Bold", width: w - 32, lineGap: 1 });
  text(body, x + 16, y + 80, { size: 8.2, color: dark ? "#B4C1D1" : C.muted, width: w - 32, lineGap: 2.2 });
}

function stepRow(y, number, title, body, accent = C.gold) {
  doc.circle(67, y + 15, 15).fillColor(accent).fill();
  text(number, 52, y + 9, { size: 10, color: C.navy, font: "Bold", width: 30, align: "center", lineGap: 0 });
  text(title, 98, y, { size: 11, color: C.white, font: "Bold", width: 390, lineGap: 1 });
  text(body, 98, y + 21, { size: 8.6, color: "#AEBED0", width: 390, lineGap: 2.5 });
  if (number !== "06") {
    doc.moveTo(67, y + 32).lineTo(67, y + 72).lineWidth(1).strokeColor("#37506D").stroke();
  }
}

function quoteBox(x, y, w, h, quote, dark = false) {
  rect(x, y, w, h, dark ? C.gold : C.navy, 14);
  text("“", x + 18, y + 7, { size: 34, color: dark ? C.navy : C.gold, font: "Bold", width: 22, lineGap: 0 });
  text(quote, x + 50, y + 20, { size: 12, color: dark ? C.navy : C.white, font: "Bold", width: w - 70, lineGap: 3 });
}

// 01 — Cover
page(C.navy);
brand(M, 40, true);
pill("POS ZA GOSTINSTVO", M, 128, 118, "#173454", C.cyan);
text("VEČ REDA\nZA ŠANKOM.", M, 182, { size: 34, color: C.white, font: "Bold", width: 320, lineGap: 0 });
text("VEČ ČASA\nZA GOSTE.", M, 270, { size: 34, color: C.gold, font: "Bold", width: 320, lineGap: 0 });
text("BOOKIE-ERP POS Gostinstvo poveže blagajno, mize, kuhinjo, točilnico, telefonska naročila, dostavo, zaloge in knjigovodstvo v enoten delovni tok.", M, 374, {
  size: 12,
  color: "#C0CCDA",
  width: 350,
  lineGap: 4,
});

// Cover visual: service flow.
rect(371, 157, 180, 320, C.navy2, 18, "#203B5A");
text("VSAK NAROČILNI TOK\nNA SVOJEM MESTU.", 393, 181, { size: 9, color: "#AFC0D3", font: "Bold", width: 136, lineGap: 3 });
const flow = [
  ["MIZE", C.blue],
  ["TO-GO", C.cyan],
  ["TELEFON", C.gold],
  ["DOSTAVA", C.green],
];
flow.forEach(([value, color], index) => {
  const yy = 251 + index * 45;
  rect(393, yy, 136, 30, "#132C4A", 8);
  dot(407, yy + 15, color, 4);
  text(value, 420, yy + 9, { size: 8.5, color: C.white, font: "Bold", width: 90, lineGap: 0 });
  if (index < flow.length - 1) {
    doc.moveTo(461, yy + 30).lineTo(461, yy + 45).lineWidth(1).strokeColor("#37506D").stroke();
  }
});
text("→ KUHINJA / TOČILNICA", 393, 438, { size: 7.5, color: C.cyan, font: "Bold", width: 136, lineGap: 0 });

text("POS, KI RAZUME TEMPO GOSTINSTVA.", M, 505, { size: 13, color: C.white, font: "Bold", width: 400, lineGap: 0 });
text("Za restavracije, bare, pizzerie, menze, lokale in obrate hitre postrežbe.", M, 532, { size: 9, color: "#9EB1C6", width: 380, lineGap: 2 });
rule(M, 616, W - M * 2, "#29415D");
text("FURS  •  KDS  •  DOSTAVA  •  ZALOGE  •  ERP", M, 638, { size: 8, color: C.cyan, font: "Bold", width: W - M * 2, lineGap: 0 });
text("Manj prepisovanja. Manj napak. Več pregleda.", M, 722, { size: 16, color: C.white, font: "Bold", width: 390, lineGap: 2 });
footer(1, true);

// 02 — Whole operation
page(C.cream);
brand(M, 38, false);
label("Celoten obrat. Enoten pogled.", M, 118);
text("VSE, KAR SE ZGODI\nV LOKALU, NA ENEM MESTU.", M, 144, { size: 27, color: C.ink, font: "Bold", width: 440, lineGap: 1 });
text("Ko naročilo potuje po pravilnem kanalu, je delo hitrejše, komunikacija jasnejša in zaključek dneva bolj zanesljiv.", M, 228, { size: 10.5, color: C.muted, width: 405, lineGap: 3.2 });

featureCard(M, 294, 244, 133, "01", "MIZE IN RAČUNI", "Odprta naročila, prenos med mizami, združevanje, delitev računa, opombe in zgodovina.", false, C.blue);
featureCard(307, 294, 244, 133, "02", "TELEFON + TO-GO", "Telefonsko naročilo brez mize, predviden čas priprave, ročni čas prevzema in zaokroževanje.", false, C.gold);
featureCard(M, 444, 244, 133, "03", "KUHINJA + TOČILNICA", "KDS zaslona po delovnem mestu. Količine, dodatki, opombe, starost naročila in pripravljeno stanje.", false, C.green);
featureCard(307, 444, 244, 133, "04", "FURS + PLAČILA", "Izdaja računov, več načinov plačila, delni računi, vračila, storna in elektronska sled.", false, C.blue);
featureCard(M, 594, 244, 133, "05", "ARTIKLI + ZALOGE", "Cene, DDV, GTIN, normative, dodatki, nabave, izdaje in pregled gibanja zalog.", false, C.gold);
featureCard(307, 594, 244, 133, "06", "IZMENE + POROČILA", "Odpiranje in zapiranje izmen, promet, število računov in dnevni pregled poslovanja.", false, C.green);
rect(M, 758, W - M * 2, 39, C.navy, 12);
text("Od prvega naročila do zaključka izmene — vse ostane povezano.", M + 18, 771, { size: 9, color: C.white, font: "Bold", width: W - M * 2 - 36, lineGap: 0 });
footer(2);

// 03 — Ordering and delivery
page(C.navy);
brand(M, 38, true);
label("Naročilo brez izgubljenih podrobnosti.", M, 118, C.cyan);
text("OD PRVEGA KLICA\nDO DOSTAVE.", M, 144, { size: 29, color: C.white, font: "Bold", width: 430, lineGap: 1 });
text("Telefon ni več listek ob blagajni. Postane strukturirano naročilo, ki ga ekipa vidi, pripravi in zaključi.", M, 230, { size: 10.5, color: "#B4C1D1", width: 410, lineGap: 3.2 });

stepRow(297, "01", "CTI ZAJEM KLICA", "Dohodni klic se prek varnega žetona za posamezno enoto poveže s pravim lokalom.", C.cyan);
stepRow(378, "02", "NAROČNIK IN NASLOV", "Iskanje po telefonski številki, naročnik, naslov po enoti ter naselje z nastavljeno ceno in časom dostave.", C.gold);
stepRow(459, "03", "ČAS, KI GA EKIPA RAZUME", "Predviden čas priprave, ročni čas prevzema ali dostave ter zaokroževanje časa za jasen dogovor z gostom.", C.green);
stepRow(540, "04", "KUHINJA IN TOČILNICA", "Naročilo se prikaže na pravem KDS zaslonu; hrana in pijača imata svoj delovni tok.", C.cyan);
stepRow(621, "05", "DOSTAVA, KI SE OBRAČUNA PRAVILNO", "Dostavni artikel, cena, čas in podatki naročila ostanejo zabeleženi skupaj — brez prepisovanja.", C.gold);
stepRow(702, "06", "ZAKLJUČEK NA BLAGAJNI", "Ko je naročilo pripravljeno, sledi plačilo in FURS račun z enako sledjo od klica do izdaje.", C.green);

quoteBox(M, 748, W - M * 2, 49, "Telefon je naročilo — ne opomnik v zvezku.", true);
footer(3, true);

// 04 — Control
page(C.cream);
brand(M, 38, false);
label("Kontrola brez upočasnjevanja.", M, 118);
text("BLAGAJNA, KI DRŽI\nKONTROLO.", M, 144, { size: 29, color: C.ink, font: "Bold", width: 420, lineGap: 1 });
text("BOOKIE-ERP POS je narejen za trenutek, ko je lokal poln: ko mora biti vsak račun pravilen, vsaka miza pregledna in vsaka izmena zaključena brez ugibanja.", M, 228, { size: 10.5, color: C.muted, width: 445, lineGap: 3.2 });

rect(M, 294, W - M * 2, 106, C.navy, 14);
text("FURS-PRIPRAVLJENA PRODAJA", M + 20, 313, { size: 8, color: C.cyan, font: "Bold", width: 230, lineGap: 0 });
text("Računi z ZOI/EOR sledjo, preverjanje seštevkov, ponovni poskus po napaki ter urejeno storniranje.", M + 20, 337, { size: 10, color: C.white, width: 300, lineGap: 3 });
pill("Zanesljiv zaključek", M + 370, 329, 125, C.gold, C.navy);

const controls = [
  ["PLAČILA", "Gotovina, kartica in drugi načini plačila; tudi delna plačila."],
  ["RAČUNI", "Delitev po postavkah, vračila, zgodovina, storna in darilni boni."],
  ["IZMENE", "Odpiranje, zapiranje, blagajna, natakar, promet in število računov."],
  ["TISKANJE", "USB, Bluetooth, omrežni tiskalniki ter namenski mostovi za POS naprave."],
];
controls.forEach(([title, body], index) => {
  const x = index % 2 === 0 ? M : 307;
  const y = 427 + Math.floor(index / 2) * 112;
  rect(x, y, 244, 92, C.white, 12, C.line);
  check(x + 18, y + 19, index === 1 ? C.gold : C.blue);
  text(title, x + 38, y + 15, { size: 9, color: C.ink, font: "Bold", width: 170, lineGap: 0 });
  text(body, x + 18, y + 43, { size: 8.4, color: C.muted, width: 204, lineGap: 2.4 });
});

quoteBox(M, 673, W - M * 2, 78, "Vsak račun ima sled. Vsaka izmena ima sliko prometa.", false);
text("Ko je lokal zaprt, naj ne ostane odprto vprašanje.", M, 783, { size: 9, color: C.muted, font: "Bold", width: W - M * 2, lineGap: 0 });
footer(4);

// 05 — ERP bridge
page(C.navy);
brand(M, 38, true);
label("Od prodaje do številk.", M, 118, C.cyan);
text("POS, KI NE OSTANE\nNA BLAGAJNI.", M, 144, { size: 29, color: C.white, font: "Bold", width: 430, lineGap: 1 });
text("Največja prednost dobrega POS-a ni samo hitrejša prodaja. Je to, da se podatki ne izgubijo med blagajno, zalogo in računovodstvom.", M, 228, { size: 10.5, color: "#B4C1D1", width: 445, lineGap: 3.2 });

// Integration path
const boxes = [
  ["01", "PRODAJA", "artikli • DDV • plačila"],
  ["02", "ZALOGA", "prejemnice • izdaje • normativi"],
  ["03", "KNJIŽENJE", "dnevne ali mesečne temeljnice"],
  ["04", "ERP", "glavna knjiga • e-računi • poročila"],
];
boxes.forEach(([num, title, body], i) => {
  const x = M + i * 130;
  rect(x, 319, 112, 122, i === 3 ? C.gold : C.navy2, 12, i === 3 ? C.gold : "#294562");
  text(num, x + 14, 335, { size: 8, color: i === 3 ? C.navy : C.cyan, font: "Bold", width: 30, lineGap: 0 });
  text(title, x + 14, 364, { size: 12, color: i === 3 ? C.navy : C.white, font: "Bold", width: 88, lineGap: 1 });
  text(body, x + 14, 397, { size: 7.4, color: i === 3 ? "#34445A" : "#AEBED0", width: 88, lineGap: 2.2 });
  if (i < boxes.length - 1) {
    text("→", x + 114, 367, { size: 18, color: C.gold, font: "Bold", width: 16, lineGap: 0, align: "center" });
  }
});

text("KONKRETNE PREDNOSTI ZA LASTNIKA IN RAČUNOVODJO", M, 499, { size: 8, color: C.gold, font: "Bold", width: 330, lineGap: 0 });
const benefits = [
  "Prodajni promet se sinhronizira v računovodske temeljnice.",
  "DDV kode, prihodkovni konti in vrste prodaje ostanejo sledljivi.",
  "Zaloge imajo gibanje, nabave, izdaje, normative in drsečo tehtano vrednost.",
  "Izdani e-računi se lahko generirajo kot XML/PDF ter pošljejo prek bizBoxa ali e-pošte.",
  "Več enot, uporabniške vloge in podatkovna izolacija podpirajo rast lokala ali verige.",
];
benefits.forEach((value, i) => {
  const y = 532 + i * 37;
  check(M, y + 1, C.cyan);
  text(value, M + 22, y, { size: 9, color: "#C3CFDD", width: 470, lineGap: 1 });
});
quoteBox(M, 737, W - M * 2, 57, "Enkrat vneseno. Uporabno na več mestih.", true);
footer(5, true);

// 06 — Comparison and CTA
page(C.cream);
brand(M, 38, false);
label("Ko želite več kot samo račun.", M, 118);
text("ZAKAJ BOOKIE-ERP\nPOS GOSTINSTVO?", M, 144, { size: 28, color: C.ink, font: "Bold", width: 430, lineGap: 1 });
text("Ker lokal potrebuje en sistem, ki razume prodajo, pripravo, dostavo, zalogo in zaključek dneva — ne pet nepovezanih rešitev.", M, 228, { size: 10.5, color: C.muted, width: 445, lineGap: 3.2 });

rect(M, 292, 507, 34, C.navy, 9);
text("GOSTINSKI IZZIV", M + 15, 304, { size: 8, color: "#AEBED0", font: "Bold", width: 190, lineGap: 0 });
text("BOOKIE-ERP PREDNOST", M + 260, 304, { size: 8, color: C.cyan, font: "Bold", width: 220, lineGap: 0 });
const rows = [
  ["Več kanalov naročanja", "mize, to-go, telefon in dostava v istem toku"],
  ["Papirčki za kuhinjo", "KDS zaslon za kuhinjo in ločeno za točilnico"],
  ["Prepisovanje v računovodstvo", "POS dnevne temeljnice in povezava z ERP"],
  ["Zaloga po občutku", "artikli, normativi, prejemnice, izdaje in gibanja"],
  ["Nejasen zaključek izmene", "promet, računi, blagajna in zgodovina na enem mestu"],
  ["Ena rešitev za vse lokale", "aktivna enota, uporabniške vloge in varna izolacija"],
];
rows.forEach(([challenge, advantage], i) => {
  const y = 326 + i * 57;
  rect(M, y, 507, 49, i % 2 === 0 ? C.white : "#F0F3F7", 0);
  text(challenge, M + 15, y + 11, { size: 8.8, color: C.ink, font: "Bold", width: 218, lineGap: 1 });
  text(advantage, M + 260, y + 11, { size: 8.8, color: C.navy, width: 225, lineGap: 1 });
  if (i < rows.length - 1) rule(M + 15, y + 49, 477, C.line);
});

rect(M, 689, 507, 92, C.navy, 14);
text("PRIČNITE Z BOLJ MIRNIM DELOVNIM DNEVOM.", M + 20, 708, { size: 14, color: C.white, font: "Bold", width: 380, lineGap: 1 });
text("Dogovorite se za predstavitev BOOKIE-ERP POS Gostinstvo in poglejte, kako lahko vaš lokal poveže prodajo, pripravo, dostavo in knjigovodstvo.", M + 20, 735, { size: 8.8, color: "#B4C1D1", width: 360, lineGap: 2.5 });
pill("DOGOVORITE SE ZA PRIKAZ", M + 386, 717, 101, C.gold, C.navy);
text("BOOKIE-ERP POS Gostinstvo  •  modularna rešitev za sodoben gostinski obrat", M, 803, { size: 7.5, color: C.muted, font: "Bold", width: W - M * 2, lineGap: 0 });
footer(6);

doc.end();
console.log(outputPath);