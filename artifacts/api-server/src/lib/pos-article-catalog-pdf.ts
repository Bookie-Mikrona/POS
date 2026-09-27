import PDFDocument from "pdfkit";
import path from "path";

export type ArticleCatalogScope = "nabavni" | "prodajni" | "polizdelki" | "drobni" | "embalaza";

export type ArticleCatalogIngredient = {
  name: string;
  quantity: number;
  unit: string | null;
};

export type ArticleCatalogSupplierBalance = {
  supplierName: string;
  quantity: number;
};

export type ArticleCatalogRow = {
  id: number;
  name: string;
  active: boolean;
  category: string | null;
  unit: string | null;
  articleType: string | null;
  purchaseName?: string | null;
  purchaseOnly?: boolean;
  salesOnly?: boolean;
  groupPurchase?: boolean;
  smallEquipment?: boolean;
  returnablePackaging?: boolean;
  packagingType?: string | null;
  depositValue?: number | null;
  price?: number | null;
  taxRate?: number | null;
  grossWeightG?: number | null;
  netWeightG?: number | null;
  netSharePercent?: number | null;
  stockQuantity?: number | null;
  supplierBalances?: ArticleCatalogSupplierBalance[];
  supplierBalanceTotal?: number | null;
  isPizza?: boolean;
  preparationType?: string | null;
  preparationMinutes?: number | null;
  preparationNotes?: string[];
  ingredients?: ArticleCatalogIngredient[];
};

export type ArticleCatalogPdfInput = {
  scope: ArticleCatalogScope;
  unitName: string;
  generatedAt: Date;
  articles: ArticleCatalogRow[];
};

const FONT_DIR = path.join(import.meta.dirname, "..", "assets", "fonts");
const FONT_REG = path.join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");
const MARGIN = 40;
const BOTTOM_MARGIN = 42;
const PAGE_TITLES: Record<ArticleCatalogScope, string> = {
  nabavni: "KATALOG NABAVNIH ARTIKLOV",
  prodajni: "KATALOG PRODAJNIH ARTIKLOV",
  polizdelki: "KATALOG POLIZDELKOV",
  drobni: "KATALOG DROBNEGA INVENTARJA",
  embalaza: "KATALOG POVRATNE EMBALAŽE",
};

function collect(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function formatNumber(value: number | null | undefined): string {
  return value == null
    ? "—"
    : value.toLocaleString("sl-SI", { maximumFractionDigits: 4 });
}

function formatMoney(value: number | null | undefined): string {
  return value == null
    ? "—"
    : `${value.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function articleMatchesScope(article: ArticleCatalogRow, scope: ArticleCatalogScope): boolean {
  switch (scope) {
    case "nabavni":
      return article.purchaseOnly === true && article.smallEquipment !== true && article.returnablePackaging !== true;
    case "prodajni":
      return article.salesOnly === true;
    case "polizdelki":
      return article.purchaseOnly !== true
        && article.salesOnly !== true
        && article.returnablePackaging !== true
        && article.smallEquipment !== true;
    case "drobni":
      return article.smallEquipment === true;
    case "embalaza":
      return article.returnablePackaging === true;
  }
}

/** Export selection follows POS business-role flags, not accounting/article or preparation types. */
export function selectArticleCatalogScope(
  articles: ArticleCatalogRow[],
  scope: ArticleCatalogScope,
): ArticleCatalogRow[] {
  return articles.filter(article => articleMatchesScope(article, scope));
}

function sortArticles(articles: ArticleCatalogRow[]): ArticleCatalogRow[] {
  const collator = new Intl.Collator("sl-SI");
  return [...articles].sort((left, right) =>
    collator.compare(left.category ?? "Brez kategorije", right.category ?? "Brez kategorije")
    || collator.compare(left.name, right.name)
    || left.id - right.id,
  );
}

export async function buildArticleCatalogPdf(input: ArticleCatalogPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  const done = collect(doc);
  const title = PAGE_TITLES[input.scope];
  doc.info.Title = title;
  doc.info.Subject = `POS katalog artiklov; obseg=${input.scope}; enota=${input.unitName}`;
  doc.registerFont("Regular", FONT_REG);
  doc.registerFont("Bold", FONT_BOLD);

  const contentWidth = doc.page.width - MARGIN * 2;
  const bottom = doc.page.height - BOTTOM_MARGIN;
  let currentCategory: string | null = null;

  const drawHeader = () => {
    doc.font("Bold").fontSize(13).fillColor("#111827")
      .text(title, MARGIN, MARGIN, { width: contentWidth, lineBreak: false });
    doc.font("Regular").fontSize(8).fillColor("#6b7280")
      .text(`Enota: ${input.unitName}  ·  Izdelano: ${input.generatedAt.toLocaleDateString("sl-SI", {
        timeZone: "Europe/Ljubljana",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })}`, MARGIN, MARGIN + 21, { width: contentWidth, lineBreak: false });
    doc.moveTo(MARGIN, MARGIN + 37).lineTo(doc.page.width - MARGIN, MARGIN + 37)
      .strokeColor("#d1d5db").lineWidth(0.7).stroke();
    doc.y = MARGIN + 47;
  };

  const addPage = () => {
    doc.addPage();
    drawHeader();
    currentCategory = null;
  };

  const ensureSpace = (height: number) => {
    if (doc.y + height > bottom) addPage();
  };

  const writeWrapped = (text: string, options: { indent?: number; bold?: boolean; color?: string; size?: number } = {}) => {
    const x = MARGIN + (options.indent ?? 0);
    const width = contentWidth - (options.indent ?? 0);
    const font = options.bold ? "Bold" : "Regular";
    const size = options.size ?? 8;
    doc.font(font).fontSize(size);
    const height = doc.heightOfString(text, { width, lineGap: 1 });
    ensureSpace(height + 2);
    doc.font(font).fontSize(size).fillColor(options.color ?? "#111827")
      .text(text, x, doc.y, { width, lineGap: 1 });
    doc.y += 2;
  };

  drawHeader();
  const articles = sortArticles(selectArticleCatalogScope(input.articles, input.scope));
  if (articles.length === 0) {
    writeWrapped("V tem obsegu ni artiklov.", { color: "#6b7280" });
  }

  for (const article of articles) {
    const category = article.category?.trim() || "Brez kategorije";
    if (category !== currentCategory) {
      ensureSpace(24);
      doc.moveDown(0.25);
      doc.font("Bold").fontSize(9).fillColor("#374151")
        .text(category, MARGIN, doc.y, { width: contentWidth, lineBreak: false });
      doc.y += 14;
      currentCategory = category;
    }

    const status = article.active ? "AKTIVEN" : "NEAKTIVEN";
    writeWrapped(`Šifra (ID) ${article.id}  ·  ${article.name}  ·  ${status}`, { bold: true, size: 9 });
    const details = [
      `Enota mere: ${article.unit || "—"}`,
      `Kategorija: ${category}`,
      `Vrsta artikla: ${article.articleType || "—"}`,
    ];
    if (input.scope === "prodajni") {
      details.push(`Cena: ${formatMoney(article.price)}  ·  DDV: ${formatNumber(article.taxRate)} %`);
    } else if (input.scope === "nabavni") {
      if (article.purchaseName) details.push(`Naziv za nabavo: ${article.purchaseName}`);
      if (article.groupPurchase) details.push("Generični/skupinski nabavni artikel");
      if (article.grossWeightG != null || article.netWeightG != null || article.netSharePercent != null) {
        details.push(`Bruto/neto masa: ${formatNumber(article.grossWeightG)} g / ${formatNumber(article.netWeightG)} g  ·  Neto delež: ${formatNumber(article.netSharePercent)} %`);
      }
    } else if (input.scope === "drobni") {
      details.push(`Stanje zaloge: ${article.stockQuantity == null ? "ni knjižnega stanja" : formatNumber(article.stockQuantity)}`);
    } else if (input.scope === "embalaza") {
      details.push(`Vrsta embalaže: ${article.packagingType || "—"}  ·  Depozitna vrednost: ${formatMoney(article.depositValue)}`);
    }
    writeWrapped(details.join("  ·  "), { indent: 8, color: "#4b5563", size: 7.5 });

    if (input.scope === "embalaza") {
      const balances = article.supplierBalances ?? [];
      if (balances.length === 0) {
        writeWrapped("Dobaviteljski saldo: ni zabeleženega prometa.", { indent: 8, color: "#6b7280", size: 7.5 });
      } else {
        writeWrapped("Količina po dobaviteljih (iz prometa):", { indent: 8, bold: true, size: 7.5 });
        for (const balance of balances) {
          writeWrapped(`${balance.supplierName}: ${formatNumber(balance.quantity)} ${article.unit || "enota ni določena"}`, {
            indent: 16,
            size: 7.5,
          });
        }
        writeWrapped(
          `Skupni knjižni saldo (vsota evidentiranih prometov): ${formatNumber(article.supplierBalanceTotal)} ${article.unit || "enota ni določena"}`,
          { indent: 8, color: "#4b5563", size: 7.5 },
        );
      }
    }

    if (input.scope === "nabavni" || input.scope === "prodajni" || input.scope === "polizdelki") {
      if (article.preparationType || (article.preparationMinutes ?? 0) > 0) {
        writeWrapped(
          `Priprava: ${article.preparationType || "ni določena"}${(article.preparationMinutes ?? 0) > 0 ? `  ·  Čas: ${article.preparationMinutes} min` : ""}`,
          { indent: 8, color: "#4b5563", size: 7.5 },
        );
      }
      for (const note of article.preparationNotes ?? []) {
        writeWrapped(note, { indent: 8, color: "#4b5563", size: 7.5 });
      }
      const ingredients = article.ingredients ?? [];
      if (ingredients.length === 0) {
        writeWrapped("Normativ: ni vnesen.", { indent: 8, color: "#6b7280", size: 7.5 });
      } else {
        writeWrapped("Normativ:", { indent: 8, bold: true, size: 7.5 });
        for (const ingredient of ingredients) {
          writeWrapped(
            `• ${ingredient.name} — ${formatNumber(ingredient.quantity)} ${ingredient.unit || "enota ni določena"}`,
            { indent: 16, size: 7.5 },
          );
        }
      }
    }
    doc.moveTo(MARGIN, doc.y + 2).lineTo(doc.page.width - MARGIN, doc.y + 2)
      .strokeColor("#e5e7eb").lineWidth(0.4).stroke();
    doc.y += 7;
  }

  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    doc.switchToPage(index);
    const footer = `Stran ${index + 1} / ${pages.count}`;
    doc.font("Regular").fontSize(7).fillColor("#9ca3af")
      .text(footer, doc.page.width - MARGIN - doc.widthOfString(footer), doc.page.height - MARGIN - 12, {
        lineBreak: false,
      });
  }

  doc.end();
  return done;
}