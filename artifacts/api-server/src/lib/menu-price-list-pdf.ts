import path from "path";
import { existsSync } from "node:fs";
import PDFDocument from "pdfkit";

const FONT_DIR = [
  // Razvoj: src/lib → src/assets/fonts
  path.join(import.meta.dirname, "..", "assets", "fonts"),
  // Produkcijski bundle: dist/app.mjs → dist/assets/fonts
  path.join(import.meta.dirname, "assets", "fonts"),
  // Zagon iz korena artefakta oziroma monorepa.
  path.join(process.cwd(), "src", "assets", "fonts"),
  path.join(process.cwd(), "artifacts", "api-server", "src", "assets", "fonts"),
].find((candidate) => existsSync(path.join(candidate, "DejaVuSans.ttf")));

if (!FONT_DIR) {
  throw new Error("PDF pisave DejaVu Sans ni mogoče najti.");
}
const FONT_REGULAR = path.join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");

const COLORS = {
  navy: "#17324D",
  teal: "#087F7A",
  tealLight: "#E7F4F3",
  gold: "#D5A645",
  paper: "#F4F7F8",
  ink: "#17212B",
  muted: "#61717E",
  line: "#D9E2E6",
  allergen: "#A13B2B",
  allergenBg: "#FCEDEA",
  warning: "#8A5A00",
  warningBg: "#FFF3D4",
  white: "#FFFFFF",
};

export interface MenuPriceListCompany {
  naziv: string;
  kratekNaziv?: string | null;
  naslov?: string | null;
  ulica?: string | null;
  postnaStevilka?: string | null;
  kraj?: string | null;
  drzava?: string | null;
  podjetjeDavcna: string;
  idZaDdv?: string | null;
  zavezanecDdv?: boolean | null;
  maticnaStevilka?: string | null;
  trr?: Array<{ iban: string; bic?: string | null }> | null;
  email?: string | null;
  telefon?: string | null;
  www?: string | null;
}

export interface MenuPriceListUnit {
  ime: string;
  opis?: string | null;
}

export interface MenuPriceListItem {
  category: string;
  name: string;
  description?: string | null;
  prices: string[];
  allergens: string[];
  traces: string[];
  verified: boolean;
}

export interface MenuPriceListPdfData {
  company: MenuPriceListCompany;
  unit: MenuPriceListUnit;
  items: MenuPriceListItem[];
  generatedAt?: Date;
}

const priceFormatter = new Intl.NumberFormat("sl-SI", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

export function formatMenuPrice(value: string | number | null): string | null {
  if (value === null) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Neveljavna cena artikla v ceniku.");
  return `${priceFormatter.format(amount)} €`;
}

function collectPdf(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function nonEmpty(parts: Array<string | null | undefined>): string[] {
  return parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
}

function companyAddress(company: MenuPriceListCompany): string {
  if (company.naslov?.trim()) return company.naslov.trim();
  const locality = nonEmpty([company.postnaStevilka, company.kraj]).join(" ");
  return nonEmpty([company.ulica, locality, company.drzava]).join(", ");
}

function drawPill(
  doc: InstanceType<typeof PDFDocument>,
  text: string,
  x: number,
  y: number,
  options: { fill: string; color: string; width?: number },
): number {
  doc.font("DejaVuSans-Bold").fontSize(7.1);
  const width = options.width ?? Math.min(190, doc.widthOfString(text) + 16);
  doc.roundedRect(x, y, width, 18, 9).fill(options.fill);
  doc.fillColor(options.color).text(text, x + 8, y + 5, {
    width: width - 16,
    align: "center",
    lineBreak: false,
  });
  return width;
}

export async function generateMenuPriceListPdf(data: MenuPriceListPdfData): Promise<Buffer> {
  const generatedAt = data.generatedAt ?? new Date();
  const generatedDate = new Intl.DateTimeFormat("sl-SI", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Ljubljana",
  }).format(generatedAt);

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 34, right: 40, bottom: 48, left: 40 },
    bufferPages: true,
    info: {
      Title: `Cenik z alergeni – ${data.company.naziv}`,
      Author: data.company.naziv,
      Subject: `Cenik poslovne enote ${data.unit.ime}`,
      Creator: "Bookie POS Gostinstvo",
    },
  });
  const completed = collectPdf(doc);
  doc.registerFont("DejaVuSans", FONT_REGULAR);
  doc.registerFont("DejaVuSans-Bold", FONT_BOLD);
  doc.font("DejaVuSans");

  const pageWidth = doc.page.width;
  const contentX = doc.page.margins.left;
  const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;
  // Večji rezervirani spodnji rob prepreči prekrivanje vsebine z nogo.
  // Sama noga ostane znotraj PDFKitovega dovoljenega območja, zato njeno
  // risanje ne ustvari dodatnih praznih strani.
  const contentBottom = doc.page.height - 82;
  let cursorY = 0;

  const identifiers = nonEmpty([
    `Davčna št.: ${data.company.podjetjeDavcna}`,
    data.company.idZaDdv ? `ID za DDV: ${data.company.idZaDdv}` : null,
    data.company.zavezanecDdv === false ? "Ni zavezanec za DDV" : null,
    data.company.maticnaStevilka ? `Matična št.: ${data.company.maticnaStevilka}` : null,
  ]);
  const contacts = nonEmpty([
    data.company.telefon ? `T: ${data.company.telefon}` : null,
    data.company.email ? `E: ${data.company.email}` : null,
    data.company.www ? `W: ${data.company.www}` : null,
  ]);
  const accounts = (data.company.trr ?? [])
    .filter((account) => account.iban?.trim())
    .map((account) => `TRR: ${account.iban.trim()}${account.bic?.trim() ? ` · BIC: ${account.bic.trim()}` : ""}`);

  const drawPageHeader = (firstPage: boolean) => {
    doc.rect(0, 0, pageWidth, 8).fill(COLORS.teal);
    doc.rect(0, 8, pageWidth, 3).fill(COLORS.gold);

    if (!firstPage) {
      const titleWidth = contentWidth - 150;
      doc.font("DejaVuSans-Bold").fontSize(13);
      const titleHeight = doc.heightOfString(data.company.naziv, { width: titleWidth });
      doc.fillColor(COLORS.navy)
        .text(data.company.naziv, contentX, 27, { width: titleWidth });
      doc.font("DejaVuSans-Bold").fontSize(13).fillColor(COLORS.teal)
        .text("CENIK", contentX + contentWidth - 130, 27, { width: 130, align: "right" });
      const subtitle = `Poslovna enota: ${data.unit.ime} · ${generatedDate}`;
      const subtitleY = Math.max(49, 27 + titleHeight + 7);
      doc.font("DejaVuSans").fontSize(8);
      const subtitleHeight = doc.heightOfString(subtitle, { width: contentWidth });
      doc.font("DejaVuSans").fontSize(8).fillColor(COLORS.muted)
        .text(subtitle, contentX, subtitleY, {
          width: contentWidth,
        });
      const dividerY = subtitleY + subtitleHeight + 8;
      doc.moveTo(contentX, dividerY).lineTo(contentX + contentWidth, dividerY)
        .lineWidth(0.7).strokeColor(COLORS.line).stroke();
      cursorY = dividerY + 15;
      return;
    }

    const companyNameWidth = contentWidth - 165;
    doc.font("DejaVuSans-Bold").fontSize(20);
    const companyNameHeight = doc.heightOfString(data.company.naziv, { width: companyNameWidth });
    doc.fillColor(COLORS.navy)
      .text(data.company.naziv, contentX, 29, { width: companyNameWidth });
    let companyNameBottom = 29 + companyNameHeight;
    if (data.company.kratekNaziv?.trim() && data.company.kratekNaziv.trim() !== data.company.naziv.trim()) {
      doc.font("DejaVuSans").fontSize(8.5).fillColor(COLORS.muted)
        .text(data.company.kratekNaziv.trim(), contentX, companyNameBottom + 3, { width: companyNameWidth });
      companyNameBottom += doc.heightOfString(data.company.kratekNaziv.trim(), { width: companyNameWidth }) + 5;
    }

    doc.roundedRect(contentX + contentWidth - 145, 27, 145, 45, 8).fill(COLORS.navy);
    doc.font("DejaVuSans-Bold").fontSize(18).fillColor(COLORS.white)
      .text("CENIK", contentX + contentWidth - 135, 37, { width: 125, align: "center" });
    doc.font("DejaVuSans").fontSize(7.2).fillColor("#DDE8EF")
      .text("JEDI IN PIJAČE", contentX + contentWidth - 135, 58, {
        width: 125,
        align: "center",
      });

    let infoY = Math.max(83, companyNameBottom + 9);
    const address = companyAddress(data.company);
    if (address) {
      doc.font("DejaVuSans").fontSize(8.7).fillColor(COLORS.ink)
        .text(address, contentX, infoY, { width: contentWidth });
      infoY += doc.heightOfString(address, { width: contentWidth }) + 4;
    }
    if (identifiers.length) {
      const line = identifiers.join("  ·  ");
      doc.font("DejaVuSans").fontSize(8.1).fillColor(COLORS.muted)
        .text(line, contentX, infoY, { width: contentWidth });
      infoY += doc.heightOfString(line, { width: contentWidth }) + 4;
    }
    if (contacts.length) {
      const line = contacts.join("  ·  ");
      doc.font("DejaVuSans").fontSize(8.1).fillColor(COLORS.muted)
        .text(line, contentX, infoY, { width: contentWidth });
      infoY += doc.heightOfString(line, { width: contentWidth }) + 4;
    }
    for (const account of accounts) {
      doc.font("DejaVuSans").fontSize(8.1).fillColor(COLORS.muted)
        .text(account, contentX, infoY, { width: contentWidth });
      infoY += doc.heightOfString(account, { width: contentWidth }) + 3;
    }

    infoY += 5;
    const unitText = `POSLOVNA ENOTA  ${data.unit.ime}${data.unit.opis?.trim() ? `  ·  ${data.unit.opis.trim()}` : ""}`;
    const unitWidth = contentWidth - 132;
    doc.font("DejaVuSans-Bold").fontSize(8.4);
    const unitTextHeight = doc.heightOfString(unitText, { width: unitWidth });
    const unitHeight = Math.max(30, unitTextHeight + 14);
    doc.roundedRect(contentX, infoY, contentWidth, unitHeight, 7).fill(COLORS.tealLight);
    doc.fillColor(COLORS.teal)
      .text(unitText, contentX + 12, infoY + 7, { width: unitWidth });
    doc.font("DejaVuSans").fontSize(7.8).fillColor(COLORS.muted)
      .text(`Izvoz: ${generatedDate}`, contentX + contentWidth - 108, infoY + 10, {
        width: 96,
        align: "right",
        lineBreak: false,
      });
    cursorY = infoY + unitHeight + 17;
  };

  const addContentPage = () => {
    doc.addPage();
    drawPageHeader(false);
  };

  const ensureSpace = (height: number) => {
    if (cursorY + height > contentBottom) addContentPage();
  };

  const drawCategory = (category: string, firstCardHeight: number) => {
    doc.font("DejaVuSans-Bold").fontSize(11.2);
    const categoryText = category.toUpperCase();
    const categoryHeight = Math.max(30, doc.heightOfString(categoryText, { width: contentWidth - 34 }) + 16);
    // Naslov kategorije ne sme ostati sam na dnu strani.
    ensureSpace(categoryHeight + 9 + firstCardHeight + 7 + (cursorY > 200 ? 7 : 0));
    if (cursorY > 200) cursorY += 7;
    doc.roundedRect(contentX, cursorY, contentWidth, categoryHeight, 7).fill(COLORS.navy);
    doc.rect(contentX, cursorY, 6, categoryHeight).fill(COLORS.gold);
    doc.font("DejaVuSans-Bold").fontSize(11.2).fillColor(COLORS.white)
      .text(categoryText, contentX + 17, cursorY + 8, {
        width: contentWidth - 34,
      });
    cursorY += categoryHeight + 9;
  };

  const leftWidth = contentWidth - 148;
  const priceWidth = 126;
  const getItemLayout = (item: MenuPriceListItem, description: string, showAllergens: boolean, continued = false) => {
    const displayName = `${item.name}${continued ? " (nadaljevanje)" : ""}`;
    doc.font("DejaVuSans-Bold").fontSize(10.4);
    const nameHeight = doc.heightOfString(displayName, { width: leftWidth });
    doc.font("DejaVuSans-Bold").fontSize(9);
    const priceText = item.prices.join("\n");
    const priceHeight = doc.heightOfString(priceText, { width: priceWidth });
    doc.font("DejaVuSans").fontSize(8.2);
    const descriptionHeight = description
      ? doc.heightOfString(description, { width: leftWidth })
      : 0;
    const allergenParts = showAllergens ? [
      item.allergens.length ? `Vsebuje: ${item.allergens.join(", ")}` : item.verified
        ? "Brez navedenih alergenov" : "Podatki o alergenih niso potrjeni",
      item.traces.length ? `Sledi: ${item.traces.join(", ")}` : null,
    ].filter((part): part is string => Boolean(part)) : [];
    const allergenText = allergenParts.join("  ·  ");
    doc.font("DejaVuSans").fontSize(7.7);
    const allergenHeight = showAllergens ? doc.heightOfString(allergenText, { width: contentWidth - 40 }) : 0;
    const warningHeight = showAllergens && !item.verified ? 22 : 0;
    const bodyHeight = Math.max(nameHeight + (descriptionHeight ? descriptionHeight + 5 : 0), priceHeight);
    const cardHeight = 16 + bodyHeight + (showAllergens ? 9 + allergenHeight + warningHeight : 0) + 12;
    return { displayName, priceText, nameHeight, descriptionHeight, allergenText, allergenHeight, bodyHeight, cardHeight };
  };

  const splitDescription = (description: string): string[] => {
    const words = description.trim().split(/\s+/u).filter(Boolean);
    if (!words.length) return [""];
    const chunks: string[] = [];
    doc.font("DejaVuSans").fontSize(8.2);
    for (let start = 0; start < words.length;) {
      let low = start + 1;
      let high = words.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (doc.heightOfString(words.slice(start, middle).join(" "), { width: leftWidth }) <= 240) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }
      chunks.push(words.slice(start, low).join(" "));
      start = low;
    }
    return chunks;
  };

  const drawItem = (item: MenuPriceListItem, description: string, showAllergens: boolean, continued: boolean) => {
    const { displayName, priceText, nameHeight, descriptionHeight, allergenText, allergenHeight, bodyHeight, cardHeight } =
      getItemLayout(item, description, showAllergens, continued);
    ensureSpace(cardHeight + 7);
    doc.roundedRect(contentX, cursorY, contentWidth, cardHeight, 7)
      .fillAndStroke(COLORS.white, COLORS.line);
    doc.rect(contentX, cursorY + 7, 4, cardHeight - 14).fill(COLORS.teal);

    const top = cursorY + 12;
    doc.font("DejaVuSans-Bold").fontSize(10.4).fillColor(COLORS.ink)
      .text(displayName, contentX + 15, top, { width: leftWidth });
    if (descriptionHeight) {
      doc.font("DejaVuSans").fontSize(8.2).fillColor(COLORS.muted)
        .text(description, contentX + 15, top + nameHeight + 5, {
          width: leftWidth,
        });
    }
    doc.font("DejaVuSans-Bold").fontSize(9).fillColor(COLORS.teal)
      .text(priceText, contentX + contentWidth - priceWidth - 12, top, {
        width: priceWidth,
        align: "right",
      });

    if (showAllergens) {
      const allergenY = top + bodyHeight + 9;
      doc.roundedRect(contentX + 12, allergenY, contentWidth - 24, allergenHeight + 12, 5)
        .fill(item.allergens.length || item.traces.length ? COLORS.allergenBg : COLORS.paper);
      doc.font("DejaVuSans").fontSize(7.7)
        .fillColor(item.allergens.length || item.traces.length ? COLORS.allergen : COLORS.muted)
        .text(allergenText, contentX + 20, allergenY + 6, { width: contentWidth - 40 });

      if (!item.verified) {
        drawPill(doc, "ALERGENI NEPREVERJENI", contentX + 12, allergenY + allergenHeight + 15, {
          fill: COLORS.warningBg,
          color: COLORS.warning,
        });
      }
    }
    cursorY += cardHeight + 7;
  };

  drawPageHeader(true);
  if (data.items.length === 0) {
    doc.roundedRect(contentX, cursorY, contentWidth, 64, 8).fill(COLORS.paper);
    doc.font("DejaVuSans-Bold").fontSize(11).fillColor(COLORS.navy)
      .text("Ni aktivnih prodajnih artiklov.", contentX + 18, cursorY + 21, {
        width: contentWidth - 36,
        align: "center",
      });
  } else {
    let currentCategory = "";
    for (const item of data.items) {
      const chunks = splitDescription(item.description ?? "");
      if (item.category !== currentCategory) {
        drawCategory(item.category, getItemLayout(item, chunks[0], chunks.length === 1).cardHeight);
        currentCategory = item.category;
      }
      chunks.forEach((chunk, index) => {
        drawItem(item, chunk, index === chunks.length - 1, index > 0);
      });
    }
  }

  const pageRange = doc.bufferedPageRange();
  for (let index = pageRange.start; index < pageRange.start + pageRange.count; index += 1) {
    doc.switchToPage(index);
    const pageNumber = index - pageRange.start + 1;
    doc.moveTo(contentX, doc.page.height - 66).lineTo(contentX + contentWidth, doc.page.height - 66)
      .lineWidth(0.6).strokeColor(COLORS.line).stroke();
    doc.font("DejaVuSans").fontSize(7.2).fillColor(COLORS.muted)
      .text("Cene so v EUR. Podatke o alergenih pred naročilom preverite pri osebju.", contentX, doc.page.height - 58, {
        width: contentWidth - 80,
        lineBreak: false,
      });
    doc.font("DejaVuSans-Bold").fontSize(7.2).fillColor(COLORS.navy)
      .text(`Stran ${pageNumber} / ${pageRange.count}`, contentX + contentWidth - 80, doc.page.height - 58, {
        width: 80,
        align: "right",
        lineBreak: false,
      });
  }

  doc.end();
  return completed;
}