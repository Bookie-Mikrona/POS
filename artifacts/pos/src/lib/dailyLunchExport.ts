import { formatEur } from "./formatEur";

export type LunchMenuSection = { title: string; note?: string; items: { name: string; price?: number }[] };
export type LunchDay = { dateLabel: string; sections: LunchMenuSection[] };
export type LunchMenuData = {
  restaurant: string;
  /** Ime poslovne enote (npr. Križišče). */
  unit?: string;
  address?: string;
  /** Naslov obdobja, npr. »Ponedeljek, 19. oktober 2026« ali »19. 10. – 25. 10. 2026«. */
  periodLabel: string;
  intro: string;
  days: LunchDay[];
};

const PAD = 48;
const ACCENT = "#ea580c";
const INK = "#1f2937";
const MUTED = "#6b7280";
const LINE = "#e5d5c5";
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const ROW_ORDER = ["Predjedi", "Juhe", "Glavne jedi", "Sladice"];

export function formatLunchDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("sl-SI", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(date).replace(/^./, (c) => c.toUpperCase());
}

export function lunchMenuText(data: LunchMenuData): string {
  const lines = [[data.restaurant, data.unit].filter(Boolean).join(" – "), `Dnevna kosila – ${data.periodLabel}`, data.intro, ""];
  for (const day of data.days) {
    if (data.days.length > 1) lines.push(`=== ${day.dateLabel.toUpperCase()} ===`, "");
    for (const section of day.sections) {
      lines.push(section.title.toUpperCase() + (section.note ? ` (${section.note})` : ""));
      for (const item of section.items) lines.push(`• ${item.name}${item.price != null ? ` – ${formatEur(item.price)}` : ""}`);
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Nariše tabelo ponudbe: stolpci so dnevi, vrstice so hodi. Ena slika/stran za celo obdobje. */
export function renderLunchMenuCanvas(data: LunchMenuData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const dayCount = Math.max(1, data.days.length);
  const LABEL_W = 170;
  const colW = dayCount <= 2 ? 520 : dayCount <= 4 ? 340 : 270;
  const width = PAD * 2 + LABEL_W + colW * dayCount;
  const FS = 22;
  const LH = 30;
  const CELL_PAD = 14;
  const rows = ROW_ORDER.filter((title) => data.days.some((day) => day.sections.some((section) => section.title === title)));
  const noteFor = (title: string) => data.days.flatMap((day) => day.sections).find((section) => section.title === title)?.note;
  const rowLabel: Record<string, string> = { Predjedi: "Predjed", Juhe: "Juha", "Glavne jedi": "Glavna jed", Sladice: "Sladica" };

  ctx.font = `500 ${FS}px ${FONT}`;
  const layout = (day: LunchDay, title: string) => {
    const section = day.sections.find((s) => s.title === title);
    if (!section) return [] as { lines: string[]; price?: number }[];
    return section.items.map((item) => {
      const priceW = item.price != null ? 96 : 0;
      ctx.font = `500 ${FS}px ${FONT}`;
      return { lines: wrap(ctx, item.name, colW - CELL_PAD * 2 - priceW), price: item.price };
    });
  };
  const rowHeights = rows.map((title) => Math.max(LH + CELL_PAD * 2, ...data.days.map((day) => {
    const items = layout(day, title);
    return items.reduce((sum, item) => sum + item.lines.length * LH + 10, 0) + CELL_PAD * 2 - (items.length ? 10 : 0);
  })));
  const HEADER_H = 150;
  const DAYHEAD_H = 84;
  const FOOT_H = 70;
  const height = HEADER_H + 24 + DAYHEAD_H + rowHeights.reduce((a, b) => a + b, 0) + FOOT_H + 24;

  const scale = 2;
  canvas.width = width * scale;
  canvas.height = height * scale;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#fffaf5";
  ctx.fillRect(0, 0, width, height);

  const grad = ctx.createLinearGradient(0, 0, width, HEADER_H);
  grad.addColorStop(0, "#c2410c");
  grad.addColorStop(1, "#f97316");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, HEADER_H);
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText([data.restaurant, data.unit].filter(Boolean).join(" · ").toUpperCase(), PAD, 46);
  ctx.fillStyle = "#fff";
  ctx.font = `800 54px ${FONT}`;
  ctx.fillText("Dnevna kosila", PAD, 106);
  ctx.textAlign = "right";
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(data.periodLabel, width - PAD, 70);
  ctx.font = `400 20px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fillText(data.intro, width - PAD, 104);
  ctx.textAlign = "left";

  let y = HEADER_H + 24;
  const x0 = PAD;
  // glave stolpcev
  ctx.fillStyle = "#9a3412";
  ctx.fillRect(x0, y, LABEL_W + colW * dayCount, DAYHEAD_H);
  data.days.forEach((day, index) => {
    const [weekday, ...rest] = day.dateLabel.split(", ");
    const date = rest.join(", ").replace(/\s+\d{4}$/, "");
    const cx = x0 + LABEL_W + index * colW;
    ctx.fillStyle = "#fff";
    ctx.font = `800 28px ${FONT}`;
    ctx.fillText(weekday, cx + CELL_PAD, y + 36);
    ctx.font = `400 22px ${FONT}`;
    ctx.fillStyle = "#fed7aa";
    ctx.fillText(date, cx + CELL_PAD, y + 64);
  });
  y += DAYHEAD_H;

  rows.forEach((title, rowIndex) => {
    const h = rowHeights[rowIndex];
    ctx.fillStyle = rowIndex % 2 === 0 ? "#fff" : "#fff3e6";
    ctx.fillRect(x0, y, LABEL_W + colW * dayCount, h);
    ctx.fillStyle = ACCENT;
    ctx.font = `800 22px ${FONT}`;
    ctx.fillText(rowLabel[title].toUpperCase(), x0 + CELL_PAD, y + CELL_PAD + 22);
    const note = noteFor(title);
    if (note) {
      ctx.fillStyle = MUTED;
      ctx.font = `400 16px ${FONT}`;
      wrap(ctx, note, LABEL_W - CELL_PAD * 2).forEach((line, i) => ctx.fillText(line, x0 + CELL_PAD, y + CELL_PAD + 46 + i * 20));
    }
    data.days.forEach((day, index) => {
      const cx = x0 + LABEL_W + index * colW;
      ctx.strokeStyle = LINE;
      ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, y + h); ctx.stroke();
      let cy = y + CELL_PAD;
      const items = layout(day, title);
      if (items.length === 0) {
        ctx.fillStyle = MUTED; ctx.font = `400 ${FS}px ${FONT}`; ctx.fillText("—", cx + CELL_PAD, cy + 22);
      }
      for (const item of items) {
        ctx.fillStyle = INK;
        ctx.font = `500 ${FS}px ${FONT}`;
        item.lines.forEach((line, i) => ctx.fillText(line, cx + CELL_PAD, cy + 22 + i * LH));
        if (item.price != null) {
          ctx.font = `700 ${FS}px ${FONT}`;
          ctx.fillStyle = ACCENT;
          ctx.textAlign = "right";
          ctx.fillText(formatEur(item.price), cx + colW - CELL_PAD, cy + 22);
          ctx.textAlign = "left";
        }
        cy += item.lines.length * LH + 10;
      }
    });
    ctx.strokeStyle = LINE;
    ctx.beginPath(); ctx.moveTo(x0, y + h); ctx.lineTo(x0 + LABEL_W + colW * dayCount, y + h); ctx.stroke();
    y += h;
  });

  ctx.fillStyle = MUTED;
  ctx.font = `400 20px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText([data.restaurant, data.unit, data.address].filter(Boolean).join(" · "), width / 2, height - 30);
  ctx.textAlign = "left";
  return canvas;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Slike ni bilo mogoče ustvariti."))), "image/png"));
}

/** Enostranski PDF (širina A4 ležeče, višina sledi tabeli) z vdelano JPEG sliko. */
export async function canvasToPdfBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const jpeg = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PDF ni bilo mogoče ustvariti."))), "image/jpeg", 0.92));
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  const pageW = 842;
  const pageH = Math.round((canvas.height / canvas.width) * pageW);
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const data = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(data); length += data.length;
  };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}`);
    if (stream) { push("\nstream\n"); push(stream); push("\nendstream"); }
    push("\nendobj\n");
  };
  push("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`, bytes);
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  object(5, `<< /Length ${content.length} >>`, enc.encode(content));
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((id) => `${String(offsets[id]).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
