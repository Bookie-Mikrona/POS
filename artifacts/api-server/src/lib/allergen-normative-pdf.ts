import PDFDocument from "pdfkit";
import type { AlergenIzracun } from "./alergeni-resolver";
import { registerPdfFonts } from "./pdf-fonts";

export async function generateAllergenNormativePdf(data: {
  enotaId: number;
  artikel: {
    ime: string;
    revision: number;
    hash: string | null;
    verifiedBy: string | null;
    verifiedAt: Date | null;
  };
  izracun: AlergenIzracun;
  sestavine: Array<{ ime: string; kolicina: string }>;
}): Promise<Buffer> {
  const { enotaId, artikel, izracun, sestavine } = data;
  const pdf = new PDFDocument({ margin: 42 });
  registerPdfFonts(pdf);
  const done = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  pdf.font("DejaVuSans-Bold").fontSize(18).text("Alergenski normativ");
  pdf.font("DejaVuSans").moveDown().fontSize(11).text(`Enota: ${enotaId}`).text(`Artikel: ${artikel.ime}`);
  pdf.text(`Status: ${izracun.potrjen ? "potrjeno" : "nepreverjeno"}`);
  pdf.text(`Verzija: ${artikel.revision}; hash: ${artikel.hash ?? "ni izračunan"}`);
  pdf.text(`Čas izvoza: ${new Date().toISOString()}`);
  pdf.text(`Potrdil: ${artikel.verifiedBy ?? "ni potrjeno"} ${artikel.verifiedAt ? `(${artikel.verifiedAt.toISOString()})` : ""}`);
  pdf.moveDown().text("Sestavine / količine:");
  sestavine.forEach((s) => pdf.text(`• ${s.ime}: ${s.kolicina}`));
  pdf.moveDown().text(`Vsebuje: ${izracun.alergeni.map((a) => `${a.koda} – ${a.naziv}`).join(", ") || "ni potrjenih podatkov"}`);
  pdf.text(`Lahko vsebuje sledi: ${izracun.alergeniSledi.map((a) => `${a.koda} – ${a.naziv}`).join(", ") || "brez navedenih sledi"}`);
  pdf.moveDown().text("Izvori:");
  izracun.izvori.forEach((source) => pdf.text(`• ${source.artikel}: ${source.vir ?? "vir ni naveden"}${source.documentId ? `; dokument ${source.documentId}` : ""}`));
  if (izracun.opozorila.length) pdf.moveDown().text(`Opozorila: ${izracun.opozorila.join(" ")}`);
  pdf.end();
  return done;
}
