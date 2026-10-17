import type PDFDocument from "pdfkit";

export interface ReportDiagnostics {
  typeWarnings?: {
    code: string; name: string; storedType: string | null; effectiveType: string;
  }[];
  unclassifiedAccounts?: {
    code: string; name: string; storedType: string | null; reason: string;
    debit: number; credit: number; net: number;
  }[];
}

interface WarningState {
  doc: InstanceType<typeof PDFDocument>;
  y: number;
}

const TYPES: Record<string, string> = {
  asset: "sredstva", liability: "obveznosti", equity: "kapital",
  expense: "odhodki", revenue: "prihodki",
};
const typeLabel = (value: string | null) =>
  value == null || value.trim() === "" ? "manjka" : TYPES[value] ?? value;

export function hasReportDiagnostics(data?: ReportDiagnostics | null): boolean {
  return Boolean(data?.typeWarnings?.length || data?.unclassifiedAccounts?.length);
}

export function drawReportDiagnosticsNotice(state: WarningState, margin: number): void {
  state.doc.font("DejaVuSans-Bold").fontSize(8).fillColor("#92400e")
    .text("Poročilo vsebuje opozorila o kontih. Podrobnosti so na koncu poročila.",
      margin, state.y, { width: state.doc.page.width - 2 * margin });
  state.y = state.doc.y + 10;
}

/** Uses the same diagnostics as the screen, without altering financial totals. */
export function drawReportDiagnostics<T extends WarningState>(
  state: T, data: ReportDiagnostics, label: string, margin: number,
  ensureSpace: (state: T, height: number) => void,
): void {
  const warnings = data.typeWarnings ?? [];
  const unclassified = data.unclassifiedAccounts ?? [];
  if (!warnings.length && !unclassified.length) return;
  const { doc } = state;
  const width = doc.page.width - 2 * margin;
  const paragraph = (text: string, bold = false) => {
    // Bound each text block, including unusually long imported names/reasons.
    for (const chunk of text.match(/[\s\S]{1,600}/gu) ?? []) {
      doc.font(bold ? "DejaVuSans-Bold" : "DejaVuSans").fontSize(8);
      const height = doc.heightOfString(chunk, { width, lineGap: 2 });
      ensureSpace(state, height + 8);
      // Page headers can change the current font.
      doc.font(bold ? "DejaVuSans-Bold" : "DejaVuSans").fontSize(8)
        .fillColor(bold ? "#92400e" : "#374151")
        .text(chunk, margin, state.y, { width, lineGap: 2 });
      state.y += height + 8;
    }
  };
  ensureSpace(state, 100);
  state.y += 8;
  doc.save()
    .moveTo(margin, state.y)
    .lineTo(doc.page.width - margin, state.y)
    .strokeColor("#d97706").lineWidth(1).stroke()
    .restore();
  state.y += 10;
  paragraph(`OPOZORILA POROČILA — ${label}`, true);
  if (warnings.length) {
    paragraph("Neskladje tipa konta: konto je uvrščen po SRS razredu šifre, ne po shranjenem tipu. Preverite nastavitve kontnega plana.", true);
    for (const warning of warnings) {
      paragraph(`${warning.code} — ${warning.name}\nShranjeni tip: ${typeLabel(warning.storedType)}; uvrščen kot: ${typeLabel(warning.effectiveType)}.`);
    }
  }
  if (unclassified.length) {
    paragraph("NERAZVRŠČENI KONTI — spodnji zneski niso vključeni v razvrščene seštevke poročila. Poročilo ni popolno, dokler ne uredite razvrstitve.", true);
    const money = (value: number) => value.toLocaleString("sl-SI", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    for (const account of unclassified) {
      paragraph(`${account.code} — ${account.name}\nShranjeni tip: ${typeLabel(account.storedType)}. ${account.reason}\nDebet: ${money(account.debit)} EUR; kredit: ${money(account.credit)} EUR; neto (debet − kredit): ${money(account.net)} EUR.`);
    }
  }
}

/** Correct estimated page numbers after diagnostics have added pages. */
export function finalizeReportPageNumbers(doc: InstanceType<typeof PDFDocument>, margin: number): void {
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    doc.switchToPage(page);
    const y = doc.page.height - margin - 5;
    doc.save();
    doc.rect(margin, y - 1, doc.page.width - 2 * margin, 12).fill("#ffffff");
    doc.font("DejaVuSans").fontSize(7).fillColor("#9ca3af");
    const date = new Date().toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
    doc.text(`Generirano: ${date}`, margin, y, { lineBreak: false });
    const pageLabel = `Stran ${page - range.start + 1} / ${range.count}`;
    // Position explicitly: right alignment requires wrapping width in PDFKit.
    doc.text(pageLabel, doc.page.width - margin - doc.widthOfString(pageLabel), y, {
      lineBreak: false,
    });
    doc.restore();
  }
}
