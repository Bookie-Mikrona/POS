import { formatEur } from "./formatEur";

export type LunchMenuSection = { title: string; note?: string; items: { name: string; price?: number }[] };
export type LunchMenuData = {
  restaurant: string;
  address?: string;
  dateLabel: string;
  intro: string;
  sections: LunchMenuSection[];
};

const WIDTH = 1080;
const PAD = 72;
const ACCENT = "#ea580c";
const INK = "#1f2937";
const MUTED = "#6b7280";
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export function formatLunchDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("sl-SI", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(date).replace(/^./, (c) => c.toUpperCase());
}

export function lunchMenuText(data: LunchMenuData): string {
  const lines = [data.restaurant, `Dnevna ponudba kosil – ${data.dateLabel}`, data.intro, ""];
  for (const section of data.sections) {
    lines.push(section.title.toUpperCase() + (section.note ? ` (${section.note})` : ""));
    for (const item of section.items) lines.push(`• ${item.name}${item.price != null ? ` – ${formatEur(item.price)}` : ""}`);
    lines.push("");
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

/** Nariše lično sliko ponudbe (1080 px širine), primerno za družbena omrežja, e-pošto in PDF. */
export function renderLunchMenuCanvas(data: LunchMenuData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const measure = canvas.getContext("2d")!;
  const innerWidth = WIDTH - PAD * 2;
  const ITEM_H = 46;
  const itemLines = (text: string, priceWidth: number) => {
    measure.font = `500 32px ${FONT}`;
    return wrap(measure, text, innerWidth - priceWidth - 32);
  };
  const HEADER_H = 300;
  let height = HEADER_H + 40;
  for (const section of data.sections) {
    height += 90;
    for (const item of section.items) {
      height += itemLines(item.name, item.price != null ? 150 : 0).length * ITEM_H + 8;
    }
    height += 30;
  }
  height += 120;

  const scale = 2;
  canvas.width = WIDTH * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#fffaf5";
  ctx.fillRect(0, 0, WIDTH, height);

  const grad = ctx.createLinearGradient(0, 0, WIDTH, HEADER_H);
  grad.addColorStop(0, "#c2410c");
  grad.addColorStop(1, "#f97316");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEADER_H);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText(data.restaurant.toUpperCase(), PAD, 78);
  ctx.fillStyle = "#fff";
  ctx.font = `800 72px ${FONT}`;
  ctx.fillText("Dnevna kosila", PAD, 164);
  ctx.font = `500 36px ${FONT}`;
  ctx.fillText(data.dateLabel, PAD, 220);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `400 26px ${FONT}`;
  ctx.fillText(data.intro, PAD, 266);

  let y = HEADER_H + 40;
  for (const section of data.sections) {
    ctx.fillStyle = ACCENT;
    ctx.font = `800 30px ${FONT}`;
    ctx.fillText(section.title.toUpperCase(), PAD, y + 40);
    if (section.note) {
      const w = ctx.measureText(section.title.toUpperCase()).width;
      ctx.fillStyle = MUTED;
      ctx.font = `400 24px ${FONT}`;
      ctx.fillText(section.note, PAD + w + 18, y + 40);
    }
    ctx.fillStyle = ACCENT;
    ctx.fillRect(PAD, y + 56, 56, 4);
    y += 90;
    for (const item of section.items) {
      const priceText = item.price != null ? formatEur(item.price) : "";
      const lines = itemLines(item.name, item.price != null ? 150 : 0);
      ctx.fillStyle = INK;
      ctx.font = `500 32px ${FONT}`;
      lines.forEach((line, index) => ctx.fillText(line, PAD, y + 32 + index * ITEM_H));
      if (priceText) {
        ctx.font = `700 32px ${FONT}`;
        ctx.fillStyle = ACCENT;
        ctx.textAlign = "right";
        ctx.fillText(priceText, WIDTH - PAD, y + 32);
        ctx.textAlign = "left";
      }
      y += lines.length * ITEM_H + 8;
    }
    y += 30;
  }
  ctx.fillStyle = MUTED;
  ctx.font = `400 24px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText([data.restaurant, data.address].filter(Boolean).join(" · "), WIDTH / 2, height - 52);
  ctx.textAlign = "left";
  return canvas;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Slike ni bilo mogoče ustvariti."))), "image/png"));
}

/** Enostaven enostranski PDF (A4 širina, višina sledi sliki) z vdelano JPEG sliko. */
export async function canvasToPdfBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const jpeg = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PDF ni bilo mogoče ustvariti."))), "image/jpeg", 0.92));
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  const pageW = 595;
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
